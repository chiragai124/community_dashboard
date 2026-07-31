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
 * Patches that arrived before there was a cache to put them in. A late result
 * can land in the gap between a pull resolving and getSnapshot storing it, so
 * queue rather than drop — dropping is what makes a slow source never recover.
 */
let queuedPatches: ((snapshot: IntegrationSnapshot) => void)[] = [];

/** Apply a late result to the cached snapshot, or queue it if there isn't one. */
function patchCache(mutate: (snapshot: IntegrationSnapshot) => void): void {
  if (!cache) {
    queuedPatches.push(mutate);
    return;
  }
  mutate(cache);
  cache.fetchedAt = new Date().toISOString();
}

function storeSnapshot(snapshot: IntegrationSnapshot): IntegrationSnapshot {
  cache = snapshot;
  if (queuedPatches.length > 0) {
    const patches = queuedPatches;
    queuedPatches = [];
    for (const patch of patches) patch(cache);
    cache.fetchedAt = new Date().toISOString();
  }
  return cache;
}

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
  /**
   * Applies a result to a cached snapshot. Called when the source finishes
   * after we stopped waiting for it, so slowness self-heals by the next load.
   */
  applyLate?: (snapshot: IntegrationSnapshot, result: T) => void,
): Promise<T> {
  const fetchedAt = new Date().toISOString();
  try {
    return await withTimeout(fetcher(), label, (late) => {
      if (!applyLate) return;
      patchCache((snapshot) => applyLate(snapshot, late));
    });
  } catch (err) {
    return { ...emptyResult, state: errorState(name, label, err, fetchedAt) } as T;
  }
}

async function pull(endWeek: string): Promise<IntegrationSnapshot> {
  // All three are independent — run them together, and let each fail alone.
  const [sheets, ga4, shortio] = await Promise.all([
    safeSource(
      'sheets',
      'Registrations (Sheets)',
      fetchRegistrations,
      { registrations: [] },
      (snapshot, late) => {
        snapshot.registrations = late.registrations;
        snapshot.states = replaceState(snapshot.states, late.state);
      },
    ),
    safeSource(
      'ga4',
      'Site traffic (GA4)',
      () => fetchGa4Sessions(endWeek),
      { rows: [] },
      (snapshot, late) => {
        snapshot.ga4 = late.rows;
        snapshot.states = replaceState(snapshot.states, late.state);
      },
    ),
    safeSource(
      'shortio',
      'Link clicks (Short.io)',
      fetchShortLinks,
      { links: [] },
      (snapshot, late) => {
        snapshot.shortLinks = late.links;
        snapshot.states = replaceState(snapshot.states, late.state);
      },
    ),
  ]);

  return {
    registrations: sheets.registrations,
    ga4: ga4.rows,
    shortLinks: shortio.links,
    states: [sheets.state, ga4.state, shortio.state],
    fetchedAt: new Date().toISOString(),
  };
}

/** Swap one source's state in place, keeping the display order stable. */
function replaceState(
  states: IntegrationState[],
  next: IntegrationState,
): IntegrationState[] {
  return states.map((s) => (s.name === next.name ? next : s));
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
    // Store here, not in the caller: a background revalidation has no caller
    // waiting on it, and its result must still reach the cache.
    .then((snapshot) => storeSnapshot(snapshot))
    .finally(() => {
      inFlight = null;
    });
  inFlight = promise;
  return promise;
}

/**
 * Cached snapshot, pulling only when stale. Safe to call from any page.
 *
 * Stale-while-revalidate: once anything is cached, a stale cache is served
 * immediately and the refresh happens in the background. Only a cold cache waits
 * on the network, so a source that is merely slow costs one slow page load
 * rather than every page load.
 */
export async function getSnapshot(
  endWeek: string = currentWeekStart(),
): Promise<IntegrationSnapshot> {
  try {
    if (isFresh(cache)) return cache;

    if (cache) {
      // Stale but usable. Kick a refresh and hand back what we have.
      if (!inFlight) void startPull(endWeek);
      return cache;
    }

    // Cold: nothing to show yet, so this one render has to wait.
    // Concurrent page renders share one pull rather than triggering three.
    return await (inFlight ?? startPull(endWeek));
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
    return await startPull(endWeek);
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
