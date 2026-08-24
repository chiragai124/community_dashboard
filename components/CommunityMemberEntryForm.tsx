'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { CommunitySlug } from '@/lib/types';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Manual "Total Members" entry for one community — replaces the old
 * WhatsApp-parsed member count, which undercounted since exports don't
 * reliably contain a group's full join/leave history. Every save adds a
 * dated point to that community's history (see lib/community-members.ts);
 * saving the same date again corrects that entry instead of duplicating it.
 */
export function CommunityMemberEntryForm({
  community,
  currentTotal,
}: {
  community: CommunitySlug;
  currentTotal: number | null;
}) {
  const router = useRouter();
  const [total, setTotal] = useState(currentTotal !== null ? String(currentTotal) : '');
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const working = busy || isPending;

  async function save() {
    const parsed = Number(total);
    if (total.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
      setError('Enter a valid, non-negative member total.');
      return;
    }
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      const res = await fetch('/api/community-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ community, total: parsed, enteredAt: date }),
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
          <div className="card__title">Update total members</div>
          <div className="card__sub">Entered manually — kept as a dated history for this community.</div>
        </div>
      </div>
      <div className="card__body">
        <div className="impRow__controls">
          <label className="field">
            <span className="field__label">Total members</span>
            <input
              type="number"
              min={0}
              step={1}
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              disabled={working}
              placeholder={currentTotal !== null ? String(currentTotal) : 'e.g. 1,904'}
            />
          </label>
          <label className="field">
            <span className="field__label">As of date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={working} />
          </label>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void save()} disabled={working}>
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
