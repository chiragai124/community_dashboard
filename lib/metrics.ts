import type {
  GroupSlug,
  IntegrationName,
  GroupWeekMetrics,
  IntegrationSnapshot,
  LeadsBySource,
  MetricKey,
  Poll,
  PollHistoryRow,
  Registration,
  WeeklyEntry,
} from './types';
import {
  ALL_SOURCE_LABELS,
  attributeRegistration,
  bucketSource,
  getGroup,
  groupHasSource,
} from './groups';
import { isInWeek, lastNWeeks, previousWeek } from './weeks';

/**
 * Every derived number in the dashboard is computed here. Nothing in this file
 * is hand-entered, and nothing outside it recomputes a rate — so a definition
 * only ever needs changing in one place.
 */

/** Safe percentage. Returns null when the denominator is missing or zero. */
export function pct(numerator: number, denominator: number | null | undefined): number | null {
  if (denominator === null || denominator === undefined || denominator === 0) return null;
  return (numerator / denominator) * 100;
}

export function pollResponses(polls: Poll[]): number {
  return polls.reduce(
    (sum, poll) => sum + poll.options.reduce((s, o) => s + o.count, 0),
    0,
  );
}

export function topOption(poll: Poll): { label: string; count: number } {
  if (poll.options.length === 0) return { label: '—', count: 0 };
  return poll.options.reduce((best, o) => (o.count > best.count ? o : best), poll.options[0]);
}

/**
 * New members for a week: the explicit override if the user typed one,
 * otherwise the delta against the previous week's total.
 */
export function newMembersFor(
  entry: WeeklyEntry | null,
  previous: WeeklyEntry | null,
): number | null {
  if (!entry) return null;
  if (entry.newMembersOverride !== null && entry.newMembersOverride !== undefined) {
    return entry.newMembersOverride;
  }
  if (!previous) return null;
  return entry.totalMembers - previous.totalMembers;
}

/* --------------------------------------------------- automated-source slices */

/**
 * Registrations belonging to a group.
 *
 * Attribution is exclusive — each registration counts towards exactly one group
 * (campaign first, then country), so the same person can never be counted in
 * two communities. See attributeRegistration in lib/groups.ts.
 */
export function registrationsForGroup(
  registrations: Registration[],
  group: GroupSlug,
): Registration[] {
  return registrations.filter((r) => attributeRegistration(r) === group);
}

/**
 * GA4 sessions for a group's campaigns within one week.
 *
 * Null — not zero — for a group whose community declares no GA4 coverage: the
 * source doesn't measure that group, so there is no number to report.
 */
export function sessionsForGroupWeek(
  snapshot: IntegrationSnapshot,
  group: GroupSlug,
  weekStart: string,
): number | null {
  const config = getGroup(group);
  if (!config || !groupHasSource(group, 'ga4')) return null;
  const campaigns = config.utmCampaigns.map((c) => c.toLowerCase());
  return snapshot.ga4
    .filter((row) => campaigns.includes(row.campaign.trim().toLowerCase()))
    .filter((row) => isInWeek(row.date, weekStart))
    .reduce((sum, row) => sum + row.sessions, 0);
}

/** Short.io clicks for a group, bucketed by lead source. */
export function clicksBySourceForGroup(
  snapshot: IntegrationSnapshot,
  group: GroupSlug,
): Map<string, number> {
  const config = getGroup(group);
  const map = new Map<string, number>();
  if (!config || !groupHasSource(group, 'shortio')) return map;
  for (const link of snapshot.shortLinks) {
    if (link.tag.trim().toLowerCase() !== config.shortioTag.toLowerCase()) continue;
    const bucket = link.source || bucketSource(link.title);
    map.set(bucket, (map.get(bucket) ?? 0) + link.clicks);
  }
  return map;
}

/**
 * Leads by source for one group-week, joined against Short.io clicks to give a
 * registrations-to-clicks conversion rate per source.
 *
 * Short.io's API reports lifetime clicks per link, not clicks-in-a-window, so
 * the weekly conversion rate below divides this week's leads by the link's
 * total clicks. It is a floor, not an exact weekly rate — the UI says so.
 */
export function leadsBySourceForGroupWeek(
  snapshot: IntegrationSnapshot,
  group: GroupSlug,
  weekStart: string,
): LeadsBySource[] {
  // No declared coverage on either side of the join → nothing to break down.
  if (!groupHasSource(group, 'sheets') && !groupHasSource(group, 'shortio')) return [];

  const regs = registrationsForGroup(snapshot.registrations, group).filter((r) =>
    isInWeek(r.timestamp, weekStart),
  );
  const clicks = clicksBySourceForGroup(snapshot, group);

  const leadCounts = new Map<string, number>();
  for (const reg of regs) {
    const bucket = bucketSource(reg.utmSource, reg.utmMedium);
    leadCounts.set(bucket, (leadCounts.get(bucket) ?? 0) + 1);
  }

  const labels = new Set<string>([...ALL_SOURCE_LABELS, ...leadCounts.keys(), ...clicks.keys()]);

  return [...labels]
    .map((source) => {
      const leads = leadCounts.get(source) ?? 0;
      const clickCount = clicks.get(source) ?? 0;
      return {
        source,
        leads,
        clicks: clickCount,
        conversionRate: clickCount > 0 ? (leads / clickCount) * 100 : null,
      };
    })
    // Drop buckets with nothing on either side so the chart isn't padded with zeros.
    .filter((row) => row.leads > 0 || row.clicks > 0)
    .sort((a, b) => b.leads - a.leads || b.clicks - a.clicks);
}

/* --------------------------------------------------------- the main assembler */

/** Manual + automated + derived, for one group and one week. */
export function buildGroupWeekMetrics(
  group: GroupSlug,
  weekStart: string,
  entries: WeeklyEntry[],
  snapshot: IntegrationSnapshot,
): GroupWeekMetrics {
  const forGroup = entries.filter((e) => e.group === group);
  const entry = forGroup.find((e) => e.weekStart === weekStart) ?? null;
  // The most recent earlier week that actually has an entry — not strictly
  // weekStart-1, so a skipped week doesn't wipe out the growth figure.
  const prev =
    [...forGroup]
      .filter((e) => e.weekStart < weekStart)
      .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))[0] ?? null;

  const responses = entry ? pollResponses(entry.polls) : 0;
  const newMembers = newMembersFor(entry, prev);

  // Sheets-covered groups get a lead count (possibly 0); everyone else gets
  // null, so "unmeasured" can never masquerade as "zero leads".
  const sheetsCovered = groupHasSource(group, 'sheets');
  const regs = sheetsCovered
    ? registrationsForGroup(snapshot.registrations, group).filter((r) =>
        isInWeek(r.timestamp, weekStart),
      )
    : [];

  return {
    group,
    community: getGroup(group)?.community ?? 'community-1',
    weekStart,
    entry,
    previousEntry: prev,

    totalMembers: entry?.totalMembers ?? null,
    newMembers,
    memberGrowthPct:
      entry && prev && prev.totalMembers > 0
        ? ((entry.totalMembers - prev.totalMembers) / prev.totalMembers) * 100
        : null,

    pollResponses: responses,
    pollCount: entry?.polls.length ?? 0,
    pollResponseRatePct: entry ? pct(responses, entry.totalMembers) : null,

    dmsSent: entry?.dmsSent ?? 0,
    dmReplies: entry?.dmReplies ?? 0,
    dmReplyRatePct: entry ? pct(entry.dmReplies, entry.dmsSent) : null,

    activityLevel: entry?.activityLevel ?? null,
    notes: entry?.notes ?? '',

    totalLeads: sheetsCovered ? regs.length : null,
    totalSessions: sessionsForGroupWeek(snapshot, group, weekStart),
    leadsBySource: leadsBySourceForGroupWeek(snapshot, group, weekStart),
  };
}

/** The same metrics across a window of weeks, oldest first. */
export function buildGroupSeries(
  group: GroupSlug,
  weeks: string[],
  entries: WeeklyEntry[],
  snapshot: IntegrationSnapshot,
): GroupWeekMetrics[] {
  return weeks.map((week) => buildGroupWeekMetrics(group, week, entries, snapshot));
}

/** Poll history for a group, newest week first, one row per poll. */
export function buildPollHistory(entries: WeeklyEntry[], group: GroupSlug): PollHistoryRow[] {
  return entries
    .filter((e) => e.group === group)
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))
    .flatMap((entry) =>
      entry.polls.map((poll) => {
        const responses = poll.options.reduce((s, o) => s + o.count, 0);
        const top = topOption(poll);
        return {
          weekStart: entry.weekStart,
          question: poll.question,
          responses,
          topAnswer: top.label,
          topAnswerCount: top.count,
          responseRatePct: pct(responses, entry.totalMembers),
        };
      }),
    );
}

/**
 * The week to show by default: the most recent week that has at least one
 * entry, falling back to the current week when the store is empty.
 */
export function latestWeekWithData(entries: WeeklyEntry[], fallback: string): string {
  if (entries.length === 0) return fallback;
  return entries.reduce((latest, e) => (e.weekStart > latest ? e.weekStart : latest), entries[0].weekStart);
}

/** Trailing window of weeks ending at `endWeek`. */
export function trendWeeks(endWeek: string, count = 8): string[] {
  return lastNWeeks(count, endWeek);
}

export { previousWeek };

/* ------------------------------------------------------ metric presentation */

export interface MetricDef {
  key: MetricKey;
  label: string;
  shortLabel: string;
  unit: 'count' | 'percent';
  /** How to describe the number in a tooltip or axis. */
  description: string;
  /**
   * The automated source this metric needs. A community that doesn't declare
   * it simply doesn't get the metric offered — no empty charts.
   */
  requires?: IntegrationName;
}

export const METRIC_DEFS: MetricDef[] = [
  {
    key: 'totalMembers',
    label: 'Total members',
    shortLabel: 'Members',
    unit: 'count',
    description: 'Group member count at the end of the week',
  },
  {
    key: 'newMembers',
    label: 'New members',
    shortLabel: 'New members',
    unit: 'count',
    description: 'Members added during the week',
  },
  {
    key: 'memberGrowthPct',
    label: 'Member growth',
    shortLabel: 'Growth %',
    unit: 'percent',
    description: 'Week-over-week change in member count',
  },
  {
    key: 'pollResponseRatePct',
    label: 'Poll response rate',
    shortLabel: 'Poll rate',
    unit: 'percent',
    description: 'Poll responses ÷ member count',
  },
  {
    key: 'dmReplyRatePct',
    label: 'DM reply rate',
    shortLabel: 'DM reply',
    unit: 'percent',
    description: 'Replies received ÷ 1:1 DMs sent',
  },
  {
    key: 'totalLeads',
    label: 'Leads',
    shortLabel: 'Leads',
    unit: 'count',
    description: 'Registrations from the sheet, attributed to this group',
    requires: 'sheets',
  },
  {
    key: 'totalSessions',
    label: 'Site traffic',
    shortLabel: 'Sessions',
    unit: 'count',
    description: "GA4 sessions on this group's UTM campaigns",
    requires: 'ga4',
  },
];

export function metricValue(m: GroupWeekMetrics, key: MetricKey): number | null {
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

/* -------------------------------------------------------------- formatting */

/** 1,284 · 12.9K — proportional-friendly compact counts. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${(value / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  return Math.round(value).toLocaleString('en-US');
}

/** Full precision with thousands separators, for tables and tooltips. */
export function formatExact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString('en-US');
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function formatSigned(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString('en-US')}`;
}

export function formatSignedPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

export function formatMetric(value: number | null, unit: 'count' | 'percent'): string {
  return unit === 'percent' ? formatPercent(value) : formatExact(value);
}

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  const hours = Math.round(diffMin / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
