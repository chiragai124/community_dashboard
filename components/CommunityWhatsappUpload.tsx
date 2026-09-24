'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { CommunitySlug, GroupSlug, ImportedFile } from '@/lib/types';
import type { SourceInfo } from '@/components/ImportPanel';
import { DateRangeFields } from '@/components/DateRangeFields';
import { formatDateRange } from '@/lib/period';
import { formatRelativeTime } from '@/lib/metrics';
import { singularize } from '@/lib/groups';
import { buildWhatsappUploadBody, type UploadProgress } from '@/lib/client-upload';

/**
 * One upload area for a whole community: drop in every group's chat export at
 * once, pick the dates once, and the batch is filed in a single step.
 *
 * Which export belongs to which group is worked out from the chat's own name
 * rather than asked for — see lib/imports/detect-group.ts. That removes the
 * step most likely to go wrong: five files and five dropdowns is five chances
 * to file Australia's conversation under Canada, and nothing downstream would
 * ever reveal the mistake.
 *
 * Every file's outcome is reported individually afterwards, naming the group
 * it matched and the evidence that matched it, so a wrong guess is visible
 * and fixable rather than silent. A file that couldn't be matched is listed
 * as such and the others still go through — one unrecognisable filename must
 * not cost the four uploads that were fine.
 *
 * The dates entered here become the reporting period for the entire
 * dashboard, not just this panel.
 */

interface FileResult {
  filename: string;
  group: GroupSlug | null;
  groupLabel: string | null;
  detectedFrom: string | null;
  ok: boolean;
  error: string | null;
  notes: string[];
  warnings: string[];
  aiGenerated: boolean;
}

interface BatchResponse {
  error?: string;
  saved?: number;
  period?: { start: string; end: string };
  results?: FileResult[];
  missingGroups?: { slug: string; label: string }[];
}

export function CommunityWhatsappUpload({
  community,
  communityLabel,
  groupNoun,
  info,
  period,
  existing,
  blobAccess,
}: {
  community: CommunitySlug;
  communityLabel: string;
  /** "Groups" or "Segments" — what this community calls its subdivisions. */
  groupNoun: string;
  info: SourceInfo;
  /** Seeds the date fields with the period currently being reported on. */
  period: { start: string; end: string };
  /** Every WhatsApp import stored for this community, any period. */
  existing: ImportedFile[];
  /**
   * The Blob store's access level, or null when Blob storage isn't
   * configured. When set, files go browser → Blob directly instead of
   * through the request body — see lib/client-upload.ts.
   */
  blobAccess: 'public' | 'private' | null;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [periodStart, setPeriodStart] = useState(period.start);
  const [periodEnd, setPeriodEnd] = useState(period.end);
  const [picked, setPicked] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<BatchResponse | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  const working = busy || isPending;
  const groupNounSingular = singularize(groupNoun);

  /*
   * Follow the reporting period when it changes elsewhere — without
   * remounting.
   *
   * These date fields seed from the active period, and a successful upload
   * *sets* that period, so keying this panel by it (the obvious way to keep
   * the fields fresh) destroyed the component the instant an upload
   * succeeded: the per-file results table, the warnings and the "filed as…"
   * confirmation all vanished before anyone could read them, and the panel
   * snapped shut. Since the dates here are what set the period in the first
   * place, this is a no-op right after an upload and the results survive; it
   * only does anything when the period is changed from the picker.
   */
  useEffect(() => {
    setPeriodStart(period.start);
    setPeriodEnd(period.end);
  }, [period.start, period.end]);

  // A "still working" signal that grows over time, rather than a static
  // "loading…" that reads the same at 1s and 90s. A batch of five full-history
  // exports plus their AI summaries genuinely takes a while, and a stalled
  // upload and a working one must not look identical.
  useEffect(() => {
    if (!busy) {
      setElapsedSec(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => setElapsedSec(Math.round((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  const filedPeriods = new Set(
    existing.filter((f) => f.periodStart && f.periodEnd).map((f) => `${f.periodStart}:${f.periodEnd}`),
  );
  const latest = [...existing].sort((a, b) =>
    (a.uploadedAt ?? '') < (b.uploadedAt ?? '') ? 1 : -1,
  )[0];

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    setError(null);
    setResponse(null);
    // Merge rather than replace, so dropping files in two goes (or picking
    // some, then dragging the rest) builds one batch instead of discarding
    // the first selection.
    setPicked((current) => {
      const byName = new Map(current.map((f) => [f.name, f]));
      for (const file of incoming) byName.set(file.name, file);
      return [...byName.values()];
    });
  }

  async function submit() {
    if (picked.length === 0) {
      setError('Pick at least one chat export first.');
      return;
    }
    if (periodEnd < periodStart) {
      setError('The end date is before the start date.');
      return;
    }

    setBusy(true);
    setError(null);
    setResponse(null);
    setProgress(null);
    try {
      const body = await buildWhatsappUploadBody({
        files: picked,
        community,
        period: { start: periodStart, end: periodEnd },
        blobAccess,
        onProgress: setProgress,
      });
      setProgress(null);

      const res = await fetch('/api/imports', { method: 'POST', body });
      const payload = (await res.json().catch(() => ({}))) as BatchResponse;

      if (!res.ok) {
        // A killed serverless function (timeout, memory limit) often comes
        // back with a gateway status and no JSON body at all, so say
        // something more useful than "Upload failed (504)".
        const fallback =
          res.status === 504
            ? 'The server took too long and timed out. Try again, or upload fewer files at once.'
            : res.status === 413
              ? 'Those files are too large for one upload. Try them in two batches.'
              : `Upload failed (${res.status}).`;
        setError(payload.error ?? fallback);
        // Per-file errors still come back on a 422, and they say far more
        // than the headline does.
        if (payload.results) setResponse(payload);
        return;
      }

      setResponse(payload);
      setPicked([]);
      startTransition(() => router.refresh());
    } catch (err) {
      if (err instanceof TypeError) {
        setError('Lost connection during the upload. Check your connection and try again.');
      } else {
        setError(err instanceof Error ? err.message : 'Upload failed.');
      }
    } finally {
      setBusy(false);
      setProgress(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const matched = response?.results?.filter((r) => r.ok) ?? [];
  const unmatched = response?.results?.filter((r) => !r.ok) ?? [];

  return (
    <details className="imp" open={filedPeriods.size === 0}>
      <summary className="imp__summary">
        <span className="qual__chevron" aria-hidden="true">
          ▶
        </span>
        <span className="qual__summaryLabel">Import WhatsApp chat exports</span>
        <span className="qual__summaryHint">
          {latest && latest.periodStart && latest.periodEnd
            ? `Latest report filed: ${formatDateRange(latest.periodStart, latest.periodEnd)}`
            : `Drop in every ${groupNoun.toLowerCase()} export for ${communityLabel} at once`}
        </span>
      </summary>

      <div className="imp__body">
        <div className="impRow">
          <div className="impRow__head">
            <div>
              <div className="impRow__title">All {groupNoun.toLowerCase()} at once</div>
              <div className="impRow__sub">
                {info.fileDescription} — one file per {groupNounSingular.toLowerCase()}.
                Each file&rsquo;s group is detected from the chat&rsquo;s own name, so nothing needs
                tagging.
              </div>
            </div>
          </div>

          <DateRangeFields
            start={periodStart}
            end={periodEnd}
            onStartChange={setPeriodStart}
            onEndChange={setPeriodEnd}
            startLabel="Report start date"
            endLabel="Report end date"
            disabled={working}
          />
          <p className="chartNote" style={{ marginTop: 0 }}>
            These dates become the reporting period for the whole dashboard — member counts, leads,
            Instagram and the landing-page figures all follow them.
          </p>

          <div
            className={`dropzone${dragging ? ' dropzone--over' : ''}${working ? ' dropzone--busy' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              if (!working) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (!working) addFiles(e.dataTransfer.files);
            }}
          >
            <input
              ref={fileInput}
              id={`wa-files-${community}`}
              className="dropzone__input"
              type="file"
              accept={info.accept}
              multiple
              disabled={working}
              onChange={(e) => addFiles(e.target.files)}
            />
            <label className="dropzone__label" htmlFor={`wa-files-${community}`}>
              <strong>Choose files</strong> or drag them here
              <span className="muted"> — {info.extensions.join(' or ')}, several at once</span>
            </label>
          </div>

          {picked.length > 0 ? (
            <div className="impRow__stored">
              <div className="rowBetween">
                <strong>
                  {picked.length} file{picked.length === 1 ? '' : 's'} ready
                </strong>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => setPicked([])}
                  disabled={working}
                >
                  Clear
                </button>
              </div>
              <ul className="impRow__notes">
                {picked.map((file) => (
                  <li key={file.name}>
                    {file.name}{' '}
                    <span className="muted">({(file.size / 1024 / 1024).toFixed(1)} MB)</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void submit()}
                disabled={working}
                style={{ marginTop: 10 }}
              >
                Import {picked.length} file{picked.length === 1 ? '' : 's'}
              </button>
            </div>
          ) : null}

          {working ? (
            <p className="impRow__status impRow__status--busy" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              {progress
                ? `Uploading ${progress.filename} (${progress.fileIndex} of ${progress.fileCount}) — ${Math.round(progress.percentage)}%`
                : busy
                  ? `Reading the exports and building this report${elapsedSec > 0 ? ` — ${elapsedSec}s` : ''}…`
                  : 'Finishing up…'}
              {!progress && elapsedSec > 20
                ? ' A full batch can take a minute or two — this is still working.'
                : ''}
            </p>
          ) : null}

          {error ? (
            <p className="formMsg formMsg--err" role="alert">
              {error}
            </p>
          ) : null}

          {response ? (
            <div className="impRow__stored">
              {matched.length > 0 ? (
                <p className="formMsg formMsg--ok" role="status">
                  Filed {matched.length} export{matched.length === 1 ? '' : 's'} for{' '}
                  {response.period
                    ? formatDateRange(response.period.start, response.period.end)
                    : 'this period'}
                  .
                </p>
              ) : null}

              {matched.length > 0 ? (
                <table className="data data--compact">
                  <thead>
                    <tr>
                      <th scope="col">File</th>
                      <th scope="col">Matched to</th>
                      <th scope="col">Detected from</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matched.map((result) => (
                      <tr key={result.filename}>
                        <td>{result.filename}</td>
                        <td>
                          <strong>{result.groupLabel}</strong>
                          {result.aiGenerated ? <span className="muted"> · AI summary</span> : null}
                        </td>
                        <td className="muted">{result.detectedFrom ?? 'chosen by hand'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}

              {/* Failures are listed separately and styled as warnings: a
                  partly-successful batch must not read as a clean success. */}
              {unmatched.length > 0 ? (
                <ul className="impRow__warnings" role="alert" style={{ marginTop: 10 }}>
                  {unmatched.map((result) => (
                    <li key={result.filename}>
                      <strong>{result.filename}</strong> — {result.error}
                    </li>
                  ))}
                </ul>
              ) : null}

              {matched.some((r) => r.warnings.length > 0) ? (
                <ul className="impRow__warnings" role="alert" style={{ marginTop: 10 }}>
                  {matched.flatMap((result) =>
                    result.warnings.map((warning) => (
                      <li key={`${result.filename}-${warning}`}>
                        <strong>{result.groupLabel}</strong> — {warning}
                      </li>
                    )),
                  )}
                </ul>
              ) : null}

              {response.missingGroups && response.missingGroups.length > 0 ? (
                <p className="chartNote">
                  No export in this batch for{' '}
                  {response.missingGroups.map((g) => g.label).join(', ')} — those{' '}
                  {response.missingGroups.length === 1 ? 'reports' : 'reports'} nothing for this
                  period.
                </p>
              ) : null}
            </div>
          ) : latest ? (
            <p className="impRow__status muted">
              {filedPeriods.size} period{filedPeriods.size === 1 ? '' : 's'} on file for{' '}
              {communityLabel}. Last upload {formatRelativeTime(latest.uploadedAt)}. Filing the same
              date range again replaces it.
            </p>
          ) : (
            <p className="impRow__status muted">Nothing imported yet for {communityLabel}.</p>
          )}
        </div>

        <details className="imp imp--steps">
          <summary className="imp__summary">
            <span className="qual__chevron" aria-hidden="true">
              ▶
            </span>
            <span className="qual__summaryLabel">How to export these from WhatsApp</span>
          </summary>
          <ol className="impRow__steps">
            {info.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
            <li>
              Repeat for each {groupNounSingular.toLowerCase()}, then select all of the
              saved files together here. Keep WhatsApp&rsquo;s own filenames where you can — they
              carry the group name, which is what identifies each file.
            </li>
          </ol>
        </details>
      </div>
    </details>
  );
}
