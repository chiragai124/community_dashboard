'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatDateRange } from '@/lib/period';

/**
 * The Instagram broadcast channel's two manual inputs.
 *
 * The member count is a reading filed against the report period, exactly like
 * the other manual figures (see NumberEntryForm on why there is no "as of"
 * date). The creation date is a standing value set once, so that field only
 * appears while it is unset, plus behind a "correct it" toggle after — a
 * standing value sitting in the form every week is a standing invitation to
 * change it by accident.
 *
 * Not the shared NumberEntryForm, because of that second field: folding an
 * optional one-time date into the generic form would complicate every other
 * use of it for the sake of this one.
 */
export function InstagramEntryForm({
  currentMembers,
  createdOn,
  period,
}: {
  currentMembers: number | null;
  createdOn: string | null;
  period: { start: string; end: string };
}) {
  const router = useRouter();
  const [members, setMembers] = useState(currentMembers !== null ? String(currentMembers) : '');
  const [created, setCreated] = useState(createdOn ?? '');
  const [editingCreated, setEditingCreated] = useState(createdOn === null);
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const working = busy || isPending;

  // Re-seed when the period changes, so switching reports shows that
  // report's count rather than the last one typed.
  useEffect(() => {
    setMembers(currentMembers !== null ? String(currentMembers) : '');
    setOk(false);
    setError(null);
  }, [currentMembers, period.start, period.end]);

  async function save() {
    const parsed = Number(members);
    const wantsMembers = members.trim() !== '';
    if (wantsMembers && (!Number.isFinite(parsed) || parsed < 0)) {
      setError('Enter a valid, non-negative member count.');
      return;
    }
    const wantsCreated = editingCreated && created !== '' && created !== createdOn;
    if (!wantsMembers && !wantsCreated) {
      setError('Enter a member count, a creation date, or both.');
      return;
    }

    setBusy(true);
    setError(null);
    setOk(false);
    try {
      const res = await fetch('/api/instagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(wantsMembers ? { members: parsed, periodStart: period.start, periodEnd: period.end } : {}),
          ...(wantsCreated ? { createdOn: created } : {}),
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? `Save failed (${res.status})`);
      setOk(true);
      if (wantsCreated) setEditingCreated(false);
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
        <div className="card__sub">
          Update this channel — the member count is entered each report; the creation date is set
          once.
        </div>
      </div>
      <div className="card__body">
        <label className="field">
          <span className="field__label">
            Member count{' '}
            <span className="field__hint">for {formatDateRange(period.start, period.end)}</span>
          </span>
          <input
            type="number"
            min={0}
            step={1}
            value={members}
            onChange={(e) => setMembers(e.target.value)}
            disabled={working}
            placeholder={currentMembers !== null ? String(currentMembers) : ''}
          />
        </label>

        {editingCreated ? (
          <label className="field" style={{ marginTop: 10 }}>
            <span className="field__label">
              Date the channel was created{' '}
              <span className="field__hint">set once — used for &ldquo;running for N weeks&rdquo;</span>
            </span>
            <input
              type="date"
              value={created}
              onChange={(e) => setCreated(e.target.value)}
              disabled={working}
            />
          </label>
        ) : (
          <p className="chartNote" style={{ marginTop: 10 }}>
            Created {createdOn}.{' '}
            <button
              type="button"
              className="linkBtn"
              onClick={() => setEditingCreated(true)}
              disabled={working}
            >
              Correct this date
            </button>
          </p>
        )}

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
          ) : null}
        </div>
      </div>
    </section>
  );
}
