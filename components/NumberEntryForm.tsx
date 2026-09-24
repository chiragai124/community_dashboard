'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatDateRange } from '@/lib/period';

/**
 * The one form for every hand-entered number on the dashboard: total members,
 * leads added, the Instagram channel's member count.
 *
 * They are the same interaction — a number, save — so they are one component
 * rather than three that drift apart. Each saves to its own endpoint and
 * appends to its own history.
 *
 * **There is no date field.** The figure is filed against the report period
 * selected at the top of the page, and the form says which that is. An
 * earlier version asked for an "as of" date and worked out the period from
 * it, which could not work on a Wednesday-to-Wednesday cadence: 16 Sep both
 * opens 16–23 Sep and closes 9–16 Sep, so the same date named two reports.
 * Filing against the range you picked is unambiguous, and it is one fewer
 * field to get wrong every week.
 */
export function NumberEntryForm({
  subtitle,
  valueLabel,
  endpoint,
  valueField,
  extraPayload,
  currentValue,
  period,
  placeholder,
}: {
  subtitle: string;
  valueLabel: string;
  endpoint: string;
  /** The field name the endpoint expects the number under, e.g. "total" or "leads". */
  valueField: string;
  /** Anything else the endpoint needs, e.g. `{ community }`. */
  extraPayload?: Record<string, string>;
  /** What was entered for this exact period, or null — not a carried-forward figure. */
  currentValue: number | null;
  /** The report period this figure is filed against. */
  period: { start: string; end: string };
  placeholder?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentValue !== null ? String(currentValue) : '');
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const working = busy || isPending;

  // Re-seed when the period (or its stored figure) changes, so switching
  // reports shows that report's number rather than the last one typed.
  useEffect(() => {
    setValue(currentValue !== null ? String(currentValue) : '');
    setOk(false);
    setError(null);
  }, [currentValue, period.start, period.end]);

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
        body: JSON.stringify({
          ...extraPayload,
          [valueField]: parsed,
          periodStart: period.start,
          periodEnd: period.end,
        }),
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
        <div className="card__sub">{subtitle}</div>
      </div>
      <div className="card__body">
        <label className="field">
          <span className="field__label">
            {valueLabel}{' '}
            <span className="field__hint">
              for {formatDateRange(period.start, period.end)}
            </span>
          </span>
          <input
            type="number"
            min={0}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={working}
            placeholder={placeholder ?? ''}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
          />
        </label>

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
              Saved for {formatDateRange(period.start, period.end)}.
            </span>
          ) : (
            <span className="muted" style={{ fontSize: 12.5 }}>
              Change the range with the report period control at the top of the page.
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
