'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Small button that POSTs to an AI-regeneration endpoint and refreshes the
 * page on success. Shared by the Overview page's Headline Takeaways and each
 * Community tab's topics/narrative synthesis — both are manually triggered,
 * not automatic, since each depends on several groups' data at once.
 */
export function RegenerateButton({
  endpoint,
  body,
  label = 'Regenerate with AI',
}: {
  endpoint: string;
  body?: Record<string, unknown>;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? `Failed (${res.status})`);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed.');
    } finally {
      setBusy(false);
    }
  }

  const working = busy || isPending;

  return (
    <div className="row" style={{ gap: 10 }}>
      <button type="button" className="btn btn--sm" onClick={() => void run()} disabled={working}>
        {working ? 'Generating…' : label}
      </button>
      {error ? (
        <span className="formMsg formMsg--err" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
