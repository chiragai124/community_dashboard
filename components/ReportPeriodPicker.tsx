'use client';

import { useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { DateRangeFields } from '@/components/DateRangeFields';
import { formatDateRange } from '@/lib/period';

/**
 * The one date control for the whole report: which period is being looked at,
 * and which period new data goes into.
 *
 * Two different actions live here on purpose, because they read the same way
 * on screen but mean very different things:
 *
 *   - **Browsing** a previously filed report changes what this page shows and
 *     nothing else. Past reports are records; opening one never edits it.
 *   - **Changing the current period** changes where the next upload or
 *     entered figure is filed, for every section of the dashboard.
 *
 * Browsing is the dropdown; changing is behind a disclosure, since it is the
 * rarer and more consequential of the two. Uploading a batch of chat exports
 * already sets the period, so most weeks nobody opens it at all.
 */

export interface PeriodOption {
  id: string;
  start: string;
  end: string;
  /** How many of this period's numbers are filled in — shown to tell a real report from an empty shell. */
  filedLabel: string;
}

export function ReportPeriodPicker({
  period,
  activePeriod,
  isActivePeriod,
  options,
}: {
  /** The period being shown. */
  period: { start: string; end: string };
  /** The period new data is currently filed under. */
  activePeriod: { start: string; end: string };
  isActivePeriod: boolean;
  /** Every filed report, newest first. */
  options: PeriodOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(activePeriod.start);
  const [end, setEnd] = useState(activePeriod.end);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const working = busy || isPending;
  const currentId = `${period.start}:${period.end}`;
  const activeId = `${activePeriod.start}:${activePeriod.end}`;

  // The active period always appears, even before anything has been filed
  // against it — otherwise the dropdown couldn't show what it is currently on.
  const listed = options.some((o) => o.id === activeId)
    ? options
    : [
        {
          id: activeId,
          start: activePeriod.start,
          end: activePeriod.end,
          filedLabel: 'nothing filed yet',
        },
        ...options,
      ];

  function show(id: string) {
    startTransition(() => {
      router.push(id === activeId ? pathname : `${pathname}?period=${encodeURIComponent(id)}`);
    });
  }

  async function saveActivePeriod() {
    if (end < start) {
      setError('The end date is before the start date.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/period', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ start, end }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? `Could not save (${res.status}).`);
      setEditing(false);
      // Straight to the new period, rather than leaving the page on whatever
      // was being viewed while the rest of the dashboard has moved on.
      startTransition(() => {
        router.push(pathname);
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`periodBar${isActivePeriod ? '' : ' periodBar--past'}`}>
      <div className="periodBar__row">
        <label className="field field--inline">
          <span className="field__label">Report period</span>
          <select
            value={currentId}
            onChange={(e) => show(e.target.value)}
            disabled={working}
            aria-label="Choose which filed report to view"
          >
            {listed.map((option) => (
              <option key={option.id} value={option.id}>
                {formatDateRange(option.start, option.end)}
                {option.id === activeId ? ' · current' : ''} — {option.filedLabel}
              </option>
            ))}
          </select>
        </label>

        {isActivePeriod ? (
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setEditing((v) => !v)}
            disabled={working}
          >
            {editing ? 'Cancel' : 'Change dates'}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--sm btn--primary"
            onClick={() => show(activeId)}
            disabled={working}
          >
            Back to current report
          </button>
        )}
      </div>

      {!isActivePeriod ? (
        <p className="periodBar__note" role="status">
          Viewing the report filed for {formatDateRange(period.start, period.end)}. New uploads and
          entries still go to the current period,{' '}
          {formatDateRange(activePeriod.start, activePeriod.end)}.
        </p>
      ) : null}

      {editing ? (
        <div className="periodBar__edit">
          <DateRangeFields
            start={start}
            end={end}
            onStartChange={setStart}
            onEndChange={setEnd}
            startLabel="Period start"
            endLabel="Period end"
            disabled={working}
          />
          <p className="chartNote" style={{ marginTop: 0 }}>
            Everything filed from now on — uploads, member counts, leads, Instagram — goes to this
            range, until it changes again.
          </p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void saveActivePeriod()}
            disabled={working}
          >
            {working ? 'Saving…' : 'Set as current period'}
          </button>
          {error ? (
            <p className="formMsg formMsg--err" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
