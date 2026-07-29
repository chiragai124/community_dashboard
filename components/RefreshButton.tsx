'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Manual re-pull of Sheets / GA4 / Short.io. Data also refreshes on page load
 * once the cache goes stale — there is deliberately no realtime sync.
 */
export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Refresh failed (${res.status})`);
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed.');
    } finally {
      setBusy(false);
    }
  }

  const working = busy || isPending;

  return (
    <span className="row">
      <button type="button" className="btn btn--sm" onClick={refresh} disabled={working}>
        <span aria-hidden="true">↻</span>
        {working ? 'Refreshing…' : 'Refresh data'}
      </button>
      {error ? (
        <span className="formMsg formMsg--err" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
