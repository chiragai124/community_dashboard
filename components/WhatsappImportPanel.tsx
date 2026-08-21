'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { GroupSlug, ImportedFile } from '@/lib/types';
import type { SourceInfo } from '@/components/ImportPanel';
import { formatRelativeTime } from '@/lib/metrics';
import { formatDateRange } from '@/lib/period';
import { splitNotes } from '@/lib/notes';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The WhatsApp upload control for one group: a manually-entered start/end
 * date and a file input.
 *
 * The export should still be the group's full chat history (needed to
 * replay member totals accurately), but the two dates here decide exactly
 * which messages count toward this report — not whatever weeks the export's
 * own timestamps happen to fall into. Filing the same range again replaces
 * it; filing a new one adds it as this group's latest report.
 */
export function WhatsappImportPanel({
  group,
  groupLabel,
  info,
  existing,
}: {
  group: GroupSlug;
  groupLabel: string;
  info: SourceInfo;
  /** Every period stored for this group, any freshness. */
  existing: ImportedFile[];
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [periodStart, setPeriodStart] = useState(today);
  const [periodEnd, setPeriodEnd] = useState(today);
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    periodStart: string | null;
    periodEnd: string | null;
    notes: string[];
    warnings: string[];
    aiGenerated: boolean;
  } | null>(null);

  const working = busy || isPending;

  const latestUpload = [...existing].sort((a, b) => ((a.periodStart ?? '') < (b.periodStart ?? '') ? 1 : -1))[0] ?? null;
  const periodsFiled = existing.length;
  const storedSplit = latestUpload ? splitNotes(latestUpload.notes) : null;

  async function upload(file: File) {
    if (periodEnd < periodStart) {
      setError('The end date is before the start date.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      body.set('file', file);
      body.set('source', 'whatsapp');
      body.set('group', group);
      body.set('periodStart', periodStart);
      body.set('periodEnd', periodEnd);

      const res = await fetch('/api/imports', { method: 'POST', body });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        periodStart?: string | null;
        periodEnd?: string | null;
        notes?: string[];
        warnings?: string[];
        aiGenerated?: boolean;
      };
      if (!res.ok) throw new Error(payload.error ?? `Upload failed (${res.status})`);

      setResult({
        periodStart: payload.periodStart ?? null,
        periodEnd: payload.periodEnd ?? null,
        notes: payload.notes ?? [],
        warnings: payload.warnings ?? [],
        aiGenerated: payload.aiGenerated ?? false,
      });
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
      // Clear the picker so re-selecting the same filename still fires onChange.
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <details className="imp" open={periodsFiled === 0 || (storedSplit?.warnings.length ?? 0) > 0}>
      <summary className="imp__summary">
        <span className="qual__chevron" aria-hidden="true">
          ▶
        </span>
        <span className="qual__summaryLabel">Import WhatsApp chat</span>
        <span className="qual__summaryHint">
          {latestUpload && latestUpload.periodStart && latestUpload.periodEnd
            ? `${info.label} — latest report: ${formatDateRange(latestUpload.periodStart, latestUpload.periodEnd)}`
            : `${info.label} — upload ${groupLabel}'s chat export`}
        </span>
      </summary>
      <div className="imp__body">
        <div className="impRow">
          <div className="impRow__head">
            <div>
              <div className="impRow__title">{info.label}</div>
              <div className="impRow__sub">
                {info.fileDescription} → {info.provides}
              </div>
            </div>
          </div>

          <div className="impRow__controls">
            <label className="field">
              <span className="field__label">Report start date</span>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                disabled={working}
              />
            </label>

            <label className="field">
              <span className="field__label">Report end date</span>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                disabled={working}
              />
            </label>
          </div>

          <label className="field">
            <span className="field__label">
              File <span className="field__hint">{info.extensions.join(' or ')}</span>
            </span>
            <input
              ref={fileInput}
              type="file"
              accept={info.accept}
              disabled={working}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </label>

          <p className="chartNote" style={{ marginTop: 0 }}>
            Upload the group's full chat export — only messages between the two dates above count
            toward this report; the rest of the export is still used to work out an accurate member
            total as of the end date.
          </p>

          {working ? <p className="impRow__status">Reading the export…</p> : null}

          {error ? (
            <p className="formMsg formMsg--err" role="alert">
              {error}
            </p>
          ) : null}

          {result && !error ? (
            <div className="impRow__stored">
              <p className="formMsg formMsg--ok" role="status">
                Filed as{' '}
                {result.periodStart && result.periodEnd
                  ? formatDateRange(result.periodStart, result.periodEnd)
                  : 'this report'}
                .{result.aiGenerated ? ' AI summary generated.' : ''}
              </p>
              {/* Warnings first and styled distinctly — something's probably
                  wrong, not just informational, and this is the difference
                  between "upload succeeded" reading as "everything's fine". */}
              {result.warnings.length > 0 ? (
                <ul className="impRow__warnings" role="alert">
                  {result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
              {result.notes.length > 0 ? (
                <ul className="impRow__notes">
                  {result.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : latestUpload ? (
            <div className="impRow__stored">
              <div className="rowBetween">
                <span>
                  <strong>{latestUpload.filename}</strong>{' '}
                  <span className="muted">uploaded {formatRelativeTime(latestUpload.uploadedAt)}</span>
                </span>
              </div>
              {storedSplit && storedSplit.warnings.length > 0 ? (
                <ul className="impRow__warnings" role="alert" style={{ marginTop: 8 }}>
                  {storedSplit.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
              <p className="chartNote" style={{ marginTop: 6 }}>
                {periodsFiled} report{periodsFiled === 1 ? '' : 's'} on file for {groupLabel}. Filing
                the same date range again replaces it.
              </p>
            </div>
          ) : (
            <p className="impRow__status muted">Nothing imported yet for {groupLabel}.</p>
          )}
        </div>

        <details className="imp imp--steps">
          <summary className="imp__summary">
            <span className="qual__chevron" aria-hidden="true">
              ▶
            </span>
            <span className="qual__summaryLabel">How to export this from WhatsApp</span>
          </summary>
          <ol className="impRow__steps">
            {info.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </details>
      </div>
    </details>
  );
}
