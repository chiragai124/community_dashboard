import type { IntegrationName, IntegrationSnapshot, IntegrationState } from '../types';
import { currentWeekStart } from '../weeks';
import { fetchRegistrations } from './sheets';
import { fetchGa4Sessions } from './ga4';
import { fetchShortLinks } from './shortio';
import { errorState, withTimeout } from './shared';

/**
 * The three automated pulls, behind one in-memory cache.
 *
 * Pages read `getSnapshot()`, which serves the cache when it is fresh and pulls
 * when it is stale. The "Refresh data" button calls `refreshSnapshot()`, which
 * always pulls. There is no realtime sync and no background polling — by design.
 *
 * The cache lives in module scope, so it is per server process. That is the right
 * scope here: a handful of viewers, data that changes weekly.
 *
 * ISOLATION IS THE POINT OF THIS FILE. Pages render on the server, so an
 * integration that throws, hangs or rejects late doesn't merely lose a number —
 * it can kill the streamed response ("failed to pipe response", HTTP 500). So
 * nothing below is allowed to reject: every source is wrapped, timed out, and
 * degraded to an error state. A red pill is always preferable to a dead page.
 */

const TTL_MS = Number(process.env.INTEGRATION_CACHE_TTL_MS ?? 10 * 60 * 1000);

let cache: IntegrationSnapshot | null = null;
let inFlight: Promise<IntegrationSnapshot> | null = null;

/**
 * Run one source with a timeout, converting ANY failure into that source's
 * error state plus an empty result. Never rejects.
 *
 * Exported so this guarantee can be exercised directly — it is the thing
 * standing between a failing integration and a dead page.
 */
export async function safeSource<T extends { state: IntegrationState }>(
  name: IntegrationName,
  label: string,
  fetcher: () => Promise<T>,
  /** What this source's payload looks like when the pull produced nothing. */
  emptyResult: Omit<T, 'state'>,
): Promise<T> {
  const fetchedAt = new Date().toISOString();
  try {
    return await withTimeout(fetcher(), label);
  } catch (err) {
    return { ...emptyResult, state: errorState(name, label, err, fetchedAt) } as T;
  }
}

async function pull(endWeek: string): Promise<IntegrationSnapshot> {
  // All three are independent — run them together, and let each fail alone.
  const [sheets, ga4, shortio] = await Promise.all([
    safeSource('sheets', 'Registrations (Sheets)', fetchRegistrations, { registrations: [] }),
    safeSource('ga4', 'Site traffic (GA4)', () => fetchGa4Sessions(endWeek), { rows: [] }),
    safeSource('shortio', 'Link clicks (Short.io)', fetchShortLinks, { links: [] }),
  ]);

  return {
    registrations: sheets.registrations,
    ga4: ga4.rows,
    shortLinks: shortio.links,
    states: [sheets.state, ga4.state, shortio.state],
    fetchedAt: new Date().toISOString(),
  };
}

/** Last-resort snapshot: renders the pages with every source marked failed. */
function emptySnapshot(err: unknown): IntegrationSnapshot {
  const fetchedAt = new Date().toISOString();
  return {
    registrations: [],
    ga4: [],
    shortLinks: [],
    states: [
      errorState('sheets', 'Registrations (Sheets)', err, fetchedAt),
      errorState('ga4', 'Site traffic (GA4)', err, fetchedAt),
      errorState('shortio', 'Link clicks (Short.io)', err, fetchedAt),
    ],
    fetchedAt,
  };
}

function isFresh(snapshot: IntegrationSnapshot | null): snapshot is IntegrationSnapshot {
  if (!snapshot) return false;
  return Date.now() - new Date(snapshot.fetchedAt).getTime() < TTL_MS;
}

/**
 * Start a pull and share it with any concurrent caller. The returned promise
 * cannot reject: `pull` is already fully guarded, and this adds a final catch so
 * a rejection can never escape as an unhandled rejection — which, mid-render,
 * would surface as a broken response rather than as a caught error.
 */
function startPull(endWeek: string): Promise<IntegrationSnapshot> {
  const promise = pull(endWeek)
    .catch((err) => emptySnapshot(err))
    .finally(() => {
      inFlight = null;
    });
  inFlight = promise;
  return promise;
}

/** Cached snapshot, pulling only when stale. Safe to call from any page. */
export async function getSnapshot(
  endWeek: string = currentWeekStart(),
): Promise<IntegrationSnapshot> {
  try {
    if (isFresh(cache)) return cache;
    // Concurrent page renders share one pull rather than triggering three.
    const snapshot = await (inFlight ?? startPull(endWeek));
    cache = snapshot;
    return snapshot;
  } catch (err) {
    // Belt and braces: a page must render even if the cache layer itself fails.
    return emptySnapshot(err);
  }
}

/** Force a pull, ignoring the cache. Backs the "Refresh data" button. */
export async function refreshSnapshot(
  endWeek: string = currentWeekStart(),
): Promise<IntegrationSnapshot> {
  try {
    const snapshot = await startPull(endWeek);
    cache = snapshot;
    return snapshot;
  } catch (err) {
    return emptySnapshot(err);
  }
}

/** True when any of the three sources is serving demo data. */
export function hasDemoSource(snapshot: IntegrationSnapshot): boolean {
  return snapshot.states.some((s) => s.status === 'demo');
}

export function hasErrorSource(snapshot: IntegrationSnapshot): boolean {
  return snapshot.states.some((s) => s.status === 'error');
}
