import { COMMUNITIES, GROUPS, groupsOf, groupsWithSource } from './groups';
import { getEntries, isShowingDemoEntries } from './store';
import { getSnapshot } from './integrations';
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
  IntegrationSnapshot,
  MetricKey,
  RollupTotals,
  TrendRow,
  WeeklyEntry,
} from './types';

/**
 * One loader shared by every page: manual entries + the three automated pulls,
 * assembled into the week being displayed and a trailing trend window.
 *
 * Loading is deliberately NOT scoped to a community — it always covers every
 * group in every community, and pages slice it. That keeps the merged roll-up a
 * filter rather than a second data path, so a community can never be silently
 * missing from a combined total.
 */

export const TREND_WINDOW = 8;

export interface DashboardData {
  entries: WeeklyEntry[];
  snapshot: IntegrationSnapshot;
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
  const [entries, snapshot] = await Promise.all([getEntries(), getSnapshot(thisWeek)]);

  // Show the current week once it has entries; otherwise fall back to the most
  // recent week that does, so the dashboard is never a grid of dashes.
  const hasCurrentWeek = entries.some((e) => e.weekStart === thisWeek);
  const displayWeek = hasCurrentWeek ? thisWeek : latestWeekWithData(entries, thisWeek);

  return {
    entries,
    snapshot,
    displayWeek,
    weeks: trendWeeks(displayWeek, TREND_WINDOW),
    perGroup: GROUPS.map((g) =>
      buildGroupWeekMetrics(g.slug, displayWeek, entries, snapshot),
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
  return buildGroupSeries(group, weeks, data.entries, data.snapshot);
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

  // Leads/sessions are null on groups without declared source coverage. A
  // roll-up over only-uncovered groups stays null — Community #1's totals must
  // say "not measured here", never "0 leads".
  const leadsCovered = metrics.filter((m) => m.totalLeads !== null);
  const sessionsCovered = metrics.filter((m) => m.totalSessions !== null);
  const leads =
    leadsCovered.length > 0
      ? leadsCovered.reduce((s, m) => s + (m.totalLeads ?? 0), 0)
      : null;
  const sessions =
    sessionsCovered.length > 0
      ? sessionsCovered.reduce((s, m) => s + (m.totalSessions ?? 0), 0)
      : null;

  return {
    members,
    newMembers,
    leads,
    sessions,
    pollResponseRatePct: pct(responses, members),
    dmReplyRatePct: pct(dmReplies, dmsSent),
    leadConversionPct: leads === null ? null : pct(leads, sessions),
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
    case 'newMembers':
    case 'totalLeads':
    case 'totalSessions': {
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
    case 'totalLeads':
      return m.totalLeads;
    case 'totalSessions':
      return m.totalSessions;
    default:
      return null;
  }
}

/* -------------------------------------------------------- traffic & funnel */

export interface TrafficFunnelTotals {
  /** Lifetime clicks across the scope's tagged Short.io links; null = no coverage. */
  clicksLifetime: number | null;
  /** GA4 sessions in the display week; null = no coverage. */
  sessionsWeek: number | null;
  /** Sheet registrations in the display week; null = no coverage. */
  leadsWeek: number | null;
  /** leads ÷ sessions for the display week, as a percentage. */
  sessionToLeadPct: number | null;
}

/**
 * The combined traffic/funnel layer over the automated sources: Short.io clicks
 * → GA4 sessions → sheet registrations. Scoped to one community, or — for the
 * merged view — to every community that declares each source. Since coverage
 * comes from config, a future community's sources join this roll-up by
 * declaration alone.
 */
export function trafficFunnel(
  data: DashboardData,
  community?: CommunitySlug,
): TrafficFunnelTotals {
  const inScope = (slug: CommunitySlug) => community === undefined || slug === community;

  const shortioGroups = groupsWithSource('shortio').filter((g) => inScope(g.community));
  const tags = new Set(shortioGroups.map((g) => g.shortioTag.toLowerCase()));
  const clicksLifetime =
    shortioGroups.length > 0
      ? data.snapshot.shortLinks
          .filter((link) => tags.has(link.tag.trim().toLowerCase()))
          .reduce((sum, link) => sum + link.clicks, 0)
      : null;

  const scoped = data.perGroup.filter((m) => inScope(m.community));
  const sessionsCovered = scoped.filter((m) => m.totalSessions !== null);
  const leadsCovered = scoped.filter((m) => m.totalLeads !== null);

  const sessionsWeek =
    sessionsCovered.length > 0
      ? sessionsCovered.reduce((s, m) => s + (m.totalSessions ?? 0), 0)
      : null;
  const leadsWeek =
    leadsCovered.length > 0
      ? leadsCovered.reduce((s, m) => s + (m.totalLeads ?? 0), 0)
      : null;

  return {
    clicksLifetime,
    sessionsWeek,
    leadsWeek,
    sessionToLeadPct: leadsWeek === null ? null : pct(leadsWeek, sessionsWeek),
  };
}

/** Daily GA4 sessions rolled up per week, for one group. */
export function weeklySessions(
  data: DashboardData,
  group: GroupSlug,
  weeks: string[] = data.weeks,
): { week: string; value: number | null }[] {
  const series = groupSeries(data, group, weeks);
  return series.map((m) => ({ week: m.weekStart, value: m.totalSessions }));
}
