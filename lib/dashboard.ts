import { GROUPS } from './groups';
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
  GroupSlug,
  GroupWeekMetrics,
  IntegrationSnapshot,
  MetricKey,
  TrendRow,
  WeeklyEntry,
} from './types';

/**
 * One loader shared by every page: manual entries + the three automated pulls,
 * assembled into the week being displayed and a trailing trend window.
 *
 * Pages call this instead of touching the store or integrations directly, so the
 * definition of "the week we're looking at" stays in one place.
 */

export const TREND_WINDOW = 8;

export interface DashboardData {
  entries: WeeklyEntry[];
  snapshot: IntegrationSnapshot;
  /** The week every "this week" figure refers to. */
  displayWeek: string;
  /** Trailing window ending at displayWeek, oldest first. */
  weeks: string[];
  /** Current-week metrics for all five groups, in sidebar order. */
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

export interface OverviewTotals {
  members: number;
  newMembers: number;
  leads: number;
  sessions: number;
  /** Responses ÷ members, pooled across all five groups. */
  pollResponseRatePct: number | null;
  /** Replies ÷ DMs sent, pooled across all five groups. */
  dmReplyRatePct: number | null;
  /** Leads ÷ sessions, pooled. */
  leadConversionPct: number | null;
  groupsWithEntry: number;
}

/**
 * Pooled totals across the five groups. Rates are computed from summed
 * numerators and denominators, not by averaging five percentages — averaging
 * rates would weight a 274-member group the same as an 1,130-member one.
 */
export function overviewTotals(perGroup: GroupWeekMetrics[]): OverviewTotals {
  const members = perGroup.reduce((s, m) => s + (m.totalMembers ?? 0), 0);
  const newMembers = perGroup.reduce((s, m) => s + (m.newMembers ?? 0), 0);
  const leads = perGroup.reduce((s, m) => s + m.totalLeads, 0);
  const sessions = perGroup.reduce((s, m) => s + m.totalSessions, 0);
  const responses = perGroup.reduce((s, m) => s + m.pollResponses, 0);
  const dmsSent = perGroup.reduce((s, m) => s + m.dmsSent, 0);
  const dmReplies = perGroup.reduce((s, m) => s + m.dmReplies, 0);

  return {
    members,
    newMembers,
    leads,
    sessions,
    pollResponseRatePct: pct(responses, members),
    dmReplyRatePct: pct(dmReplies, dmsSent),
    leadConversionPct: pct(leads, sessions),
    groupsWithEntry: perGroup.filter((m) => m.entry !== null).length,
  };
}

/** Rows shaped for the multi-series charts: one row per week, one key per group. */
export function multiGroupRows(
  data: DashboardData,
  metric: MetricKey,
  weeks: string[] = data.weeks,
): TrendRow[] {
  const seriesByGroup = new Map<GroupSlug, GroupWeekMetrics[]>();
  for (const group of GROUPS) {
    seriesByGroup.set(group.slug, groupSeries(data, group.slug, weeks));
  }

  return weeks.map((week, index) => {
    const row: TrendRow = { week };
    for (const group of GROUPS) {
      const metrics = seriesByGroup.get(group.slug)?.[index];
      row[group.slug] = metrics ? metricOf(metrics, metric) : null;
    }
    return row;
  });
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

/** Daily GA4 sessions rolled up per week, for one group. */
export function weeklySessions(
  data: DashboardData,
  group: GroupSlug,
  weeks: string[] = data.weeks,
): { week: string; value: number | null }[] {
  const series = groupSeries(data, group, weeks);
  return series.map((m) => ({ week: m.weekStart, value: m.totalSessions }));
}
