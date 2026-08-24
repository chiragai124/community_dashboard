'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { CommunitySlug, ImportSource, ImportedFile } from '@/lib/types';
import { formatWeekLabel, parseISODate, weekStartOf } from '@/lib/weeks';
import { formatRelativeTime } from '@/lib/metrics';
import { DateRangeFields } from '@/components/DateRangeFields';

/**
 * The weekly upload control: one row per source, each with the week it is for,
 * a file picker, and whatever is already stored for that week.
 *
 * Kept to a single collapsed card. This is a five-minute-a-week chore, not a
 * feature to explore, so it sits below the numbers it feeds and stays out of the
 * way until opened. The export steps live inside it rather than only in the
 * README — the instructions belong where the button is.
 */

export interface SourceInfo {
  source: ImportSource;
  label: string;
  fileDescription: string;
  accept: string;
  /** What the picker accepts, written for a person rather than for the browser. */
  extensions: string[];
  provides: string;
  /** Click-by-click export steps, shown under the picker. */
  steps: string[];
}

export function ImportPanel({
  community,
  scopeLabel,
  defaultWeek,
  sources,
  existing,
}: {
  /** Omit for a source with no community — e.g. GA4, landing-page traffic. */
  community?: CommunitySlug;
  /** What this upload is for, in plain words: a community's label, or e.g. "the landing page". */
  scopeLabel: string;
  /** Seeds the initial start/end date fields — today's displayed week. */
  defaultWeek: string;
  sources: SourceInfo[];
  /** Everything already stored for this scope, any week. */
  existing: ImportedFile[];
}) {
  return (
    <details className="imp">
      <summary className="imp__summary">
        <span className="qual__chevron" aria-hidden="true">
          ▶
        </span>
        <span className="qual__summaryLabel">Import data</span>
        <span className="qual__summaryHint">
          {sources.map((s) => s.label).join(' · ')} — upload this week’s export for{' '}
          {scopeLabel}
        </span>
      </summary>
      <div className="imp__body">
        {sources.map((source) => (
          <SourceRow
            key={source.source}
            community={community}
            info={source}
            defaultWeek={defaultWeek}
            existing={existing.filter((f) => f.source === source.source)}
          />
        ))}
      </div>
    </details>
  );
}

function SourceRow({
  community,
  info,
  defaultWeek,
  existing,
}: {
  community?: CommunitySlug;
  info: SourceInfo;
  defaultWeek: string;
  existing: ImportedFile[];
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  // Same two-date picker WhatsApp import uses, for consistency — Short.io/GA4
  // still file under one Monday-anchored week internally (derived from the
  // start date below), since each export IS one week's snapshot; the end
  // date just keeps the control visually and behaviourally identical across
  // all three import sources.
  const [periodStart, setPeriodStart] = useState(defaultWeek);
  const [periodEnd, setPeriodEnd] = useState(defaultWeek);
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  const week = weekStartOf(parseISODate(periodStart || defaultWeek));
  const stored = existing.find((f) => f.weekStart === week) ?? null;
  const working = busy || isPending;

  async function upload(file: File) {
    if (periodEnd < periodStart) {
      setError('The end date is before the start date.');
      return;
    }
    setBusy(true);
    setError(null);
    setOkMessage(null);
    try {
      const body = new FormData();
      body.set('file', file);
      body.set('source', info.source);
      // Omitted for a global source (e.g. GA4) — no community to send.
      if (community) body.set('community', community);
      body.set('weekStart', week);

      const res = await fetch('/api/imports', { method: 'POST', body });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        import?: ImportedFile;
      };
      if (!res.ok) throw new Error(payload.error ?? `Upload failed (${res.status})`);

      setOkMessage(`Imported ${file.name}.`);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
      // Clear the picker so re-selecting the same filename still fires onChange.
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    setOkMessage(null);
    try {
      const res = await fetch(`/api/imports?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `Could not remove (${res.status})`);
      }
      setOkMessage('Removed.');
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="impRow">
      <div className="impRow__head">
        <div>
          <div className="impRow__title">{info.label}</div>
          <div className="impRow__sub">
            {info.fileDescription} → {info.provides}
          </div>
        </div>
      </div>

      <DateRangeFields
        start={periodStart}
        end={periodEnd}
        onStartChange={setPeriodStart}
        onEndChange={setPeriodEnd}
        disabled={working}
      />
      <p className="chartNote" style={{ marginTop: 0 }}>
        Filed under the week of {formatWeekLabel(week)} (the Monday–Sunday week containing the
        start date above).
      </p>

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

      {working ? <p className="impRow__status impRow__status--busy" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        Reading the file…
      </p> : null}

      {error ? (
        <p className="formMsg formMsg--err" role="alert">
          {error}
        </p>
      ) : null}
      {okMessage && !error ? (
        <p className="formMsg formMsg--ok" role="status">
          {okMessage}
        </p>
      ) : null}

      {stored ? (
        <div className="impRow__stored">
          <div className="rowBetween">
            <span>
              <strong>{stored.filename}</strong>{' '}
              <span className="muted">
                uploaded {formatRelativeTime(stored.uploadedAt)}
              </span>
            </span>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => void remove(stored.id)}
              disabled={working}
            >
              Remove
            </button>
          </div>
          {/* Where each number came from, so a surprising figure can be traced
              without reopening the export. */}
          {stored.notes.length > 0 ? (
            <ul className="impRow__notes">
              {stored.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="impRow__status muted">
          Nothing imported for this week yet.
        </p>
      )}

      <details className="imp imp--steps">
        <summary className="imp__summary">
          <span className="qual__chevron" aria-hidden="true">
            ▶
          </span>
          <span className="qual__summaryLabel">How to export this from {info.label}</span>
        </summary>
        <ol className="impRow__steps">
          {info.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </details>
    </div>
  );
}
