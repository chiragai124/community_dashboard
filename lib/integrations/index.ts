import type { IntegrationSnapshot } from '../types';
import { currentWeekStart } from '../weeks';
import { fetchRegistrations } from './sheets';
import { fetchGa4Sessions } from './ga4';
import { fetchShortLinks } from './shortio';

/**
 * The three automated pulls, behind one in-memory cache.
 *
 * Pages read `getSnapshot()`, which serves the cache when it is fresh and pulls
 * when it is stale. The "Refresh data" button calls `refreshSnapshot()`, which
 * always pulls. There is no realtime sync and no background polling — by design.
 *
 * The cache lives in module scope, so it is per server process. That is the right
 * scope here: a handful of viewers, data that changes weekly.
 */

const TTL_MS = Number(process.env.INTEGRATION_CACHE_TTL_MS ?? 10 * 60 * 1000);

let cache: IntegrationSnapshot | null = null;
let inFlight: Promise<IntegrationSnapshot> | null = null;

async function pull(endWeek: string): Promise<IntegrationSnapshot> {
  // All three are independent — run them together.
  const [sheets, ga4, shortio] = await Promise.all([
    fetchRegistrations(),
    fetchGa4Sessions(endWeek),
    fetchShortLinks(),
  ]);

  return {
    registrations: sheets.registrations,
    ga4: ga4.rows,
    shortLinks: shortio.links,
    states: [sheets.state, ga4.state, shortio.state],
    fetchedAt: new Date().toISOString(),
  };
}

function isFresh(snapshot: IntegrationSnapshot | null): snapshot is IntegrationSnapshot {
  if (!snapshot) return false;
  return Date.now() - new Date(snapshot.fetchedAt).getTime() < TTL_MS;
}

/** Cached snapshot, pulling only when stale. Safe to call from any page. */
export async function getSnapshot(
  endWeek: string = currentWeekStart(),
): Promise<IntegrationSnapshot> {
  if (isFresh(cache)) return cache;
  // Concurrent page renders share one pull rather than triggering three.
  if (!inFlight) {
    inFlight = pull(endWeek).finally(() => {
      inFlight = null;
    });
  }
  cache = await inFlight;
  return cache;
}

/** Force a pull, ignoring the cache. Backs the "Refresh data" button. */
export async function refreshSnapshot(
  endWeek: string = currentWeekStart(),
): Promise<IntegrationSnapshot> {
  inFlight = pull(endWeek).finally(() => {
    inFlight = null;
  });
  cache = await inFlight;
  return cache;
}

/** True when any of the three sources is serving demo data. */
export function hasDemoSource(snapshot: IntegrationSnapshot): boolean {
  return snapshot.states.some((s) => s.status === 'demo');
}

export function hasErrorSource(snapshot: IntegrationSnapshot): boolean {
  return snapshot.states.some((s) => s.status === 'error');
}
