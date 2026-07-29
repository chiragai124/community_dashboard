import { NextResponse } from 'next/server';
import { refreshSnapshot } from '@/lib/integrations';
import { currentWeekStart } from '@/lib/weeks';

/**
 * POST /api/refresh — force a re-pull of Sheets, GA4 and Short.io.
 * Backs the "Refresh data" button; pages otherwise pull on load when the
 * cache is stale.
 */
export async function POST() {
  try {
    const snapshot = await refreshSnapshot(currentWeekStart());
    return NextResponse.json({
      fetchedAt: snapshot.fetchedAt,
      states: snapshot.states,
      counts: {
        registrations: snapshot.registrations.length,
        ga4Rows: snapshot.ga4.length,
        shortLinks: snapshot.shortLinks.length,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Refresh failed.' },
      { status: 500 },
    );
  }
}

/** GET returns the same payload, handy for checking credentials from a terminal. */
export async function GET() {
  return POST();
}
