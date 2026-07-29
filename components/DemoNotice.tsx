import type { IntegrationSnapshot } from '@/lib/types';

/**
 * Says plainly when a number on screen is demo data rather than a real pull, and
 * surfaces integration errors with the message the API returned. Nothing here is
 * decorative — if every source is live and entries are real, it renders nothing.
 */
export function DemoNotice({
  snapshot,
  demoEntries,
  /**
   * False on manual-only pages (Community #1): integration demo/error notices
   * describe data those pages never show, so only the entries notice remains.
   */
  sources = true,
}: {
  snapshot: IntegrationSnapshot;
  demoEntries: boolean;
  sources?: boolean;
}) {
  const demo = sources ? snapshot.states.filter((s) => s.status === 'demo') : [];
  const errored = sources ? snapshot.states.filter((s) => s.status === 'error') : [];

  if (demo.length === 0 && errored.length === 0 && !demoEntries) return null;

  return (
    <div className="prefillNote" style={{ marginBottom: 18 }}>
      {demoEntries ? (
        <div>
          <strong>Weekly entries are demo data.</strong> No entries have been saved yet, so
          eight weeks of sample history is shown. Your first save replaces it.
        </div>
      ) : null}

      {demo.length > 0 ? (
        <div style={{ marginTop: demoEntries ? 6 : 0 }}>
          <strong>Demo data:</strong>{' '}
          {demo.map((s) => s.label).join(', ')}. {demo[0].message} See{' '}
          <code>.env.example</code> for the full list.
        </div>
      ) : null}

      {errored.length > 0 ? (
        <div style={{ marginTop: 6 }}>
          <strong>Integration error:</strong>{' '}
          {errored.map((s) => `${s.label} — ${s.message}`).join(' · ')}
        </div>
      ) : null}
    </div>
  );
}
