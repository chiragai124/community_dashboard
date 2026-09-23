'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatDateRange } from '@/lib/period';

/**
 * The one form for every hand-entered number on the dashboard: total members,
 * leads added, the Instagram channel's member count.
 *
 * They are the same interaction — a number, the date it's true as of, save —
 * so they are one component rather than three that drift apart. Each saves to
 * its own endpoint and appends to its own dated history.
 *
 * The date defaults to the end of the period being reported on, not to today.
 * That is the difference between a figure landing in the report it belongs to
 * and landing in the next one: entering Monday's numbers on Wednesday should
 * file them against Monday's report, and defaulting to today would quietly
 * not.
 */
export function NumberEntryForm({
  title,
  subtitle,
  valueLabel,
  endpoint,
  valueField,
  extraPayload,
  currentValue,
  period,
  placeholder,
}: {
  title: string;
  subtitle: string;
  valueLabel: string;
  endpoint: string;
  /** The field name the endpoint expects the number under, e.g. "total" or "leads". */
  valueField: string;
  /** Anything else the endpoint needs, e.g. `{ community }`. */
  extraPayload?: Record<string, string>;
  currentValue: number | null;
  /** The period being reported on — seeds the as-of date. */
  period: { start: string; end: string };
  placeholder?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentValue !== null ? String(currentValue) : '');
  const [date, setDate] = useState(period.end);
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const working = busy || isPending;
  const outsidePeriod = date < period.start || date > period.end;

  async function save() {
    const parsed = Number(value);
    if (value.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
      setError(`Enter a valid, non-negative ${valueLabel.toLowerCase()}.`);
      return;
    }
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...extraPayload, [valueField]: parsed, enteredAt: date }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? `Save failed (${res.status})`);
      setOk(true);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card__head">
        <div>
          <div className="card__title">{title}</div>
          <div className="card__sub">{subtitle}</div>
        </div>
      </div>
      <div className="card__body">
        <div className="impRow__controls">
          <label className="field">
            <span className="field__label">{valueLabel}</span>
            <input
              type="number"
              min={0}
              step={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={working}
              placeholder={placeholder ?? (currentValue !== null ? String(currentValue) : '')}
            />
          </label>
          <label className="field">
            <span className="field__label">As of date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={working}
            />
          </label>
        </div>

        {/* A date outside the report period is legitimate — correcting an
            older report, say — but it is much more often a slip, and the
            figure would silently land in a different report than the one on
            screen. */}
        {outsidePeriod ? (
          <p className="formMsg formMsg--warn" role="status">
            That date is outside this report&rsquo;s period (
            {formatDateRange(period.start, period.end)}), so this figure won&rsquo;t appear in it.
          </p>
        ) : null}

        <div className="row" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => void save()}
            disabled={working}
          >
            {working ? 'Saving…' : 'Save'}
          </button>
          {error ? (
            <span className="formMsg formMsg--err" role="alert">
              {error}
            </span>
          ) : ok ? (
            <span className="formMsg formMsg--ok" role="status">
              Saved.
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
