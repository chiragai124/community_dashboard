import { COMMUNITIES, COMMUNITY_SLUGS, groupsOf } from './groups';
import { getEntries, isShowingDemoEntries } from './store';
import { getImports, importedWeek, mergedWeek } from './imports';
import {
  buildGroupSeries,
  buildGroupWeekMetrics,
  latestWeekWithData,
  pct,
  trendWeeks,
} from './metrics';
import { currentWeekStart, lastNWeeks } from './weeks';
import type {
  CommunitySlug,
  GroupSlug,
  GroupWeekMetrics,
  ImportedFile,
  ImportedWeek,
  MetricKey,
  RollupTotals,
  TrendRow,
  WeeklyEntry,
} from './types';

/**
 * One loader shared by every page: manual weekly entries plus every imported
 * file, assembled into the week being displayed and a trailing trend window.
 *
 * Loading is deliberately NOT scoped to a community — it always covers every
 * group in every community, and pages slice it. That keeps the merged roll-up a
 * filter rather than a second data path, so a community can never be silently
 * missing from a combined total.
 */

export const TREND_WINDOW = 8;

export interface DashboardData {
  entries: WeeklyEntry[];
  /** Every uploaded file, newest first. */
  imports: ImportedFile[];
  /** The week every "this week" figure refers to. */
  displayWeek: string;
  /** Trailing window ending at displayWeek, oldest first. */
  weeks: string[];
  /** Current-week metrics for every group in every community. */
  perGroup: GroupWeekMetrics[];
  /** True when weekly entries are demo seed data rather than saved entries. */
  demoEntries: boolean;
}

export async function loadDashboard(): Promise<DashboardData> {
  const thisWeek = currentWeekStart();
  const [entries, imports] = await Promise.all([getEntries(), getImports()]);

  // Show the current week once it has entries; otherwise fall back to the most
  // recent week that does, so the dashboard is never a grid of dashes.
  const hasCurrentWeek = entries.some((e) => e.weekStart === thisWeek);
  const displayWeek = hasCurrentWeek ? thisWeek : latestWeekWithData(entries, thisWeek);

  return {
    entries,
    imports,
    displayWeek,
    weeks: trendWeeks(displayWeek, TREND_WINDOW),
    perGroup: COMMUNITIES.flatMap((c) => c.groups).map((g) =>
      buildGroupWeekMetrics(g.slug, displayWeek, entries),
    ),
    demoEntries: isShowingDemoEntries(),
  };
}

/** Current-week metrics for one community's groups, in display order. */
export function groupsInCommunity(
  data: DashboardData,
  community: CommunitySlug,
): GroupWeekMetrics[] {
  const order = groupsOf(community).map((g) => g.slug);
  return order
    .map((slug) => data.perGroup.find((m) => m.group === slug))
    .filter((m): m is GroupWeekMetrics => m !== undefined);
}

/** The trailing series for one group, oldest week first. */
export function groupSeries(
  data: DashboardData,
  group: GroupSlug,
  weeks: string[] = data.weeks,
): GroupWeekMetrics[] {
  return buildGroupSeries(group, weeks, data.entries);
}

/** Weeks offered in the entry form: this week plus the previous 7, newest first. */
export function entryWeekOptions(count = TREND_WINDOW): string[] {
  return [...lastNWeeks(count, currentWeekStart())].reverse();
}

/* --------------------------------------------------------- roll-ups & series */

/**
 * Pooled totals over any set of groups.
 *
 * Rates are computed from summed numerators and denominators, not by averaging
 * percentages — averaging would weight a 274-member group the same as an
 * 1,130-member one, and would be wrong again when pooling two communities of
 * very different sizes.
 */
export function rollup(metrics: GroupWeekMetrics[]): RollupTotals {
  const members = metrics.reduce((s, m) => s + (m.totalMembers ?? 0), 0);
  const newMembers = metrics.reduce((s, m) => s + (m.newMembers ?? 0), 0);
  const responses = metrics.reduce((s, m) => s + m.pollResponses, 0);
  const dmsSent = metrics.reduce((s, m) => s + m.dmsSent, 0);
  const dmReplies = metrics.reduce((s, m) => s + m.dmReplies, 0);

  return {
    members,
    newMembers,
    pollResponseRatePct: pct(responses, members),
    dmReplyRatePct: pct(dmReplies, dmsSent),
    groupsWithEntry: metrics.filter((m) => m.entry !== null).length,
    groupCount: metrics.length,
  };
}

/** Pooled totals for one community. */
export function communityTotals(
  data: DashboardData,
  community: CommunitySlug,
): RollupTotals {
  return rollup(groupsInCommunity(data, community));
}

/** Pooled totals across every community — the merged view's headline figures. */
export function mergedTotals(data: DashboardData): RollupTotals {
  return rollup(data.perGroup);
}

/** Per-community roll-ups, in registry order. */
export function perCommunityTotals(
  data: DashboardData,
): { community: CommunitySlug; totals: RollupTotals }[] {
  return COMMUNITIES.map((c) => ({
    community: c.slug,
    totals: communityTotals(data, c.slug),
  }));
}

/** Rows shaped for the multi-series charts: one row per week, one key per group. */
export function multiGroupRows(
  data: DashboardData,
  metric: MetricKey,
  groups: GroupSlug[],
  weeks: string[] = data.weeks,
): TrendRow[] {
  const seriesByGroup = new Map<GroupSlug, GroupWeekMetrics[]>();
  for (const slug of groups) {
    seriesByGroup.set(slug, groupSeries(data, slug, weeks));
  }

  return weeks.map((week, index) => {
    const row: TrendRow = { week };
    for (const slug of groups) {
      const metrics = seriesByGroup.get(slug)?.[index];
      row[slug] = metrics ? metricOf(metrics, metric) : null;
    }
    return row;
  });
}

/**
 * Rows for the merged view's trend chart: one series per community, each the
 * pooled value of its groups for that week.
 */
export function multiCommunityRows(
  data: DashboardData,
  metric: MetricKey,
  weeks: string[] = data.weeks,
): TrendRow[] {
  const seriesByCommunity = new Map<CommunitySlug, GroupWeekMetrics[][]>();
  for (const community of COMMUNITIES) {
    seriesByCommunity.set(
      community.slug,
      community.groups.map((g) => groupSeries(data, g.slug, weeks)),
    );
  }

  return weeks.map((week, index) => {
    const row: TrendRow = { week };
    for (const community of COMMUNITIES) {
      const weekMetrics = (seriesByCommunity.get(community.slug) ?? [])
        .map((series) => series[index])
        .filter((m): m is GroupWeekMetrics => m !== undefined);
      row[community.slug] = pooledMetric(weekMetrics, metric);
    }
    return row;
  });
}

/**
 * One pooled value for a set of groups in a single week. Counts sum; rates are
 * recomputed from their own numerators and denominators rather than averaged.
 */
function pooledMetric(metrics: GroupWeekMetrics[], key: MetricKey): number | null {
  if (metrics.length === 0) return null;

  switch (key) {
    case 'totalMembers':
    case 'newMembers': {
      const values = metrics
        .map((m) => metricOf(m, key))
        .filter((v): v is number => v !== null);
      return values.length === 0 ? null : values.reduce((s, v) => s + v, 0);
    }
    case 'memberGrowthPct': {
      // Growth over the pooled base, not the mean of five growth rates.
      const withPrev = metrics.filter((m) => m.previousEntry !== null && m.entry !== null);
      if (withPrev.length === 0) return null;
      const base = withPrev.reduce((s, m) => s + (m.previousEntry?.totalMembers ?? 0), 0);
      const added = withPrev.reduce(
        (s, m) => s + ((m.entry?.totalMembers ?? 0) - (m.previousEntry?.totalMembers ?? 0)),
        0,
      );
      return pct(added, base);
    }
    case 'pollResponseRatePct': {
      const responses = metrics.reduce((s, m) => s + m.pollResponses, 0);
      const members = metrics.reduce((s, m) => s + (m.totalMembers ?? 0), 0);
      return pct(responses, members);
    }
    case 'dmReplyRatePct': {
      const replies = metrics.reduce((s, m) => s + m.dmReplies, 0);
      const sent = metrics.reduce((s, m) => s + m.dmsSent, 0);
      return pct(replies, sent);
    }
    default:
      return null;
  }
}

function metricOf(m: GroupWeekMetrics, key: MetricKey): number | null {
  switch (key) {
    case 'totalMembers':
      return m.totalMembers;
    case 'newMembers':
      return m.newMembers;
    case 'memberGrowthPct':
      return m.memberGrowthPct;
    case 'pollResponseRatePct':
      return m.pollResponseRatePct;
    case 'dmReplyRatePct':
      return m.dmReplyRatePct;
    default:
      return null;
  }
}

/* ------------------------------------------------------- imported figures -- */

/** The imported figures for one community and the displayed week. */
export function communityImported(
  data: DashboardData,
  community: CommunitySlug,
  weekStart: string = data.displayWeek,
): ImportedWeek {
  return importedWeek(data.imports, community, weekStart);
}

/** The same, pooled across every community — the merged view. */
export function mergedImported(
  data: DashboardData,
  weekStart: string = data.displayWeek,
): ImportedWeek {
  return mergedWeek(data.imports, COMMUNITY_SLUGS, weekStart);
}

/**
 * One imported figure across the trend window, oldest week first.
 *
 * A week with no upload is null, not zero, so a gap in the weekly routine shows
 * as a break in the line rather than as traffic collapsing to nothing.
 */
export function importedSeries(
  data: DashboardData,
  community: CommunitySlug | 'merged',
  pick: (week: ImportedWeek) => number | null,
  weeks: string[] = data.weeks,
): { week: string; value: number | null }[] {
  return weeks.map((week) => ({
    week,
    value: pick(
      community === 'merged'
        ? mergedWeek(data.imports, COMMUNITY_SLUGS, week)
        : importedWeek(data.imports, community, week),
    ),
  }));
}

/** The four imported headline figures, in display order. */
export const IMPORTED_FIGURES: {
  key: string;
  label: string;
  hint: string;
  pick: (week: ImportedWeek) => number | null;
}[] = [
  {
    key: 'activeUsers',
    label: 'Active users',
    hint: 'GA4 · this week',
    pick: (w) => w.ga4?.activeUsers ?? null,
  },
  {
    key: 'newUsers',
    label: 'New users',
    hint: 'GA4 · this week',
    pick: (w) => w.ga4?.newUsers ?? null,
  },
  {
    key: 'sessions',
    label: 'Sessions',
    hint: 'GA4 · source/medium',
    pick: (w) => w.ga4?.sessions ?? null,
  },
  {
    key: 'clicks',
    label: 'Link clicks',
    hint: 'Short.io · this week',
    pick: (w) => w.shortio?.totalClicks ?? null,
  },
];
