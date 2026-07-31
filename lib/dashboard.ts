import { COMMUNITIES, COMMUNITY_SLUGS, groupsOf } from './groups';
import { getEntries } from './store';
import { getLeads } from './leads';
import { getImports, importedWeek, mergedWeek } from './imports';
import { getChatImports, type GroupChatImport } from './whatsapp/store';
import {
  buildGroupSeries,
  buildGroupWeekMetrics,
  latestWeekWithData,
  pct,
  trendWeeks,
} from './metrics';
import { currentWeekStart, lastNWeeks } from './weeks';
import type {
  CommonQuestion,
  CommunitySlug,
  GroupSlug,
  GroupWeekMetrics,
  ImportedFile,
  ImportedWeek,
  Lead,
  MemberSourceKey,
  MetricKey,
  NewMembersBySource,
  RollupTotals,
  SentimentBreakdown,
  SentimentKey,
  TopicTerm,
  TrendRow,
  WeeklyEntry,
} from './types';
import { MEMBER_SOURCE_KEYS, MEMBER_SOURCE_LABELS, SENTIMENT_KEYS } from './types';

/**
 * One loader shared by every page: the three imports plus the two hand-typed
 * figures, assembled into the week being displayed and a trailing trend window.
 *
 * Loading is deliberately NOT scoped to a community — it always covers every
 * group in every community, and pages slice it. That keeps the merged roll-up a
 * filter rather than a second data path, so a community can never be silently
 * missing from a combined total.
 */

export const TREND_WINDOW = 8;

export interface DashboardData {
  entries: WeeklyEntry[];
  /** Short.io and GA4 files, newest first. */
  imports: ImportedFile[];
  /** One chat-derived record per group that has had an export uploaded. */
  chatImports: GroupChatImport[];
  /** Hand-entered leads. Personal data — see lib/leads.ts. */
  leads: Lead[];
  /** The week every "this week" figure refers to. */
  displayWeek: string;
  /** Trailing window ending at displayWeek, oldest first. */
  weeks: string[];
  /** Current-week metrics for every group in every community. */
  perGroup: GroupWeekMetrics[];
}

export async function loadDashboard(): Promise<DashboardData> {
  const thisWeek = currentWeekStart();
  const [entries, imports, chatImports, leads] = await Promise.all([
    getEntries(),
    getImports(),
    getChatImports(),
    getLeads(),
  ]);

  // Show the current week once anything covers it; otherwise fall back to the
  // most recent week that has data, so the dashboard is never a grid of dashes
  // just because this week's export hasn't been uploaded yet.
  const hasCurrentWeek =
    entries.some((e) => e.weekStart === thisWeek) ||
    chatImports.some((r) => r.weeks.some((w) => w.weekStart === thisWeek));
  const displayWeek = hasCurrentWeek
    ? thisWeek
    : latestWeekWithData(entries, chatImports, thisWeek);

  return {
    entries,
    imports,
    chatImports,
    leads,
    displayWeek,
    weeks: trendWeeks(displayWeek, TREND_WINDOW),
    perGroup: COMMUNITIES.flatMap((c) => c.groups).map((g) =>
      buildGroupWeekMetrics(g.slug, displayWeek, entries, chatImports),
    ),
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
  return buildGroupSeries(group, weeks, data.entries, data.chatImports);
}

/** Weeks offered in the entry form: this week plus the previous 7, newest first. */
export function entryWeekOptions(count = TREND_WINDOW): string[] {
  return [...lastNWeeks(count, currentWeekStart())].reverse();
}

/* --------------------------------------------------------- roll-ups & series */

/** Sum, staying null when nothing in scope reported the figure at all. */
function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : present.reduce((s, v) => s + v, 0);
}

/**
 * Pooled totals over any set of groups.
 *
 * Rates are computed from summed numerators and denominators, not by averaging
 * percentages — averaging would weight a 274-member group the same as an
 * 1,130-member one, and would be wrong again when pooling two communities of very
 * different sizes.
 *
 * Every count stays null when no group in scope has an export covering the week,
 * so an un-imported week reads as unmeasured rather than as a community that lost
 * all its members.
 */
export function rollup(metrics: GroupWeekMetrics[]): RollupTotals {
  const members = sumOrNull(metrics.map((m) => m.totalMembers));
  const responses = metrics.reduce((s, m) => s + m.pollResponses, 0);
  // Same rule as the per-group figure: no poll recorded means no rate, not 0%.
  const anyPoll = metrics.some((m) => m.pollCount > 0);
  const dmsSent = metrics.reduce((s, m) => s + m.dmsSent, 0);
  const dmReplies = metrics.reduce((s, m) => s + m.dmReplies, 0);

  return {
    members,
    newMembers: sumOrNull(metrics.map((m) => m.newMembers)),
    messages: sumOrNull(metrics.map((m) => m.messages)),
    activeParticipants: sumOrNull(metrics.map((m) => m.activeParticipants)),
    pollResponseRatePct: anyPoll ? pct(responses, members) : null,
    dmReplyRatePct: pct(dmReplies, dmsSent),
    groupsWithChat: metrics.filter((m) => m.chat !== null).length,
    groupCount: metrics.length,
  };
}

export function communityTotals(
  data: DashboardData,
  community: CommunitySlug,
): RollupTotals {
  return rollup(groupsInCommunity(data, community));
}

export function mergedTotals(data: DashboardData): RollupTotals {
  return rollup(data.perGroup);
}

export function perCommunityTotals(
  data: DashboardData,
): { community: CommunitySlug; totals: RollupTotals }[] {
  return COMMUNITIES.map((c) => ({
    community: c.slug,
    totals: communityTotals(data, c.slug),
  }));
}

/* ------------------------------------------------- pooled topics & sentiment */

/**
 * Topics pooled over several groups.
 *
 * Message counts add, so a term used in three groups outranks one used heavily in
 * a single group. That is the right ordering for a combined report: the question
 * it answers is "what were students talking about across the community", not
 * "which group talked most".
 */
export function pooledTopics(metrics: GroupWeekMetrics[], limit = 12): TopicTerm[] {
  const totals = new Map<string, TopicTerm>();
  for (const m of metrics) {
    for (const topic of m.topics) {
      const existing = totals.get(topic.term);
      if (existing) {
        existing.messages += topic.messages;
        existing.score += topic.score;
      } else {
        totals.set(topic.term, { ...topic });
      }
    }
  }
  return [...totals.values()]
    .sort((a, b) => b.score - a.score || b.messages - a.messages)
    .slice(0, limit);
}

/** Questions pooled over several groups, most-asked first. */
export function pooledQuestions(metrics: GroupWeekMetrics[], limit = 8): CommonQuestion[] {
  const totals = new Map<string, CommonQuestion>();
  for (const m of metrics) {
    for (const question of m.questions) {
      const key = question.text.toLowerCase();
      const existing = totals.get(key);
      if (existing) existing.asked += question.asked;
      else totals.set(key, { ...question });
    }
  }
  return [...totals.values()]
    .sort((a, b) => b.asked - a.asked || a.text.length - b.text.length)
    .slice(0, limit);
}

/**
 * Sentiment pooled over several groups, weighted by how many messages each
 * group actually scored.
 *
 * Weighting matters: a five-message group at 100% positive must not pull the
 * combined figure as hard as a five-hundred-message group at 50%. Averaging the
 * percentages would do exactly that.
 */
export function pooledSentiment(metrics: GroupWeekMetrics[]): {
  sentiment: SentimentBreakdown;
  scored: number;
  withSignal: number;
} {
  let scored = 0;
  let withSignal = 0;
  const counts: Record<SentimentKey, number> = { positive: 0, neutral: 0, negative: 0 };
  const examples: Record<SentimentKey, string[]> = { positive: [], neutral: [], negative: [] };

  for (const m of metrics) {
    if (m.sentimentScored === 0) continue;
    scored += m.sentimentScored;
    withSignal += m.sentimentWithSignal;
    for (const key of SENTIMENT_KEYS) {
      const share = shareOf(m.sentiment, key);
      if (share !== null) counts[key] += (share / 100) * m.sentimentScored;
      examples[key].push(...m.sentiment.examples[key]);
    }
  }

  if (scored === 0) {
    return {
      sentiment: {
        positivePct: null,
        neutralPct: null,
        negativePct: null,
        examples: { positive: [], neutral: [], negative: [] },
      },
      scored: 0,
      withSignal: 0,
    };
  }

  const asPct = (n: number) => Math.round((n / scored) * 1000) / 10;
  return {
    sentiment: {
      positivePct: asPct(counts.positive),
      neutralPct: asPct(counts.neutral),
      negativePct: asPct(counts.negative),
      // Three per sentiment overall, taken across groups in display order.
      examples: {
        positive: examples.positive.slice(0, 3),
        neutral: examples.neutral.slice(0, 3),
        negative: examples.negative.slice(0, 3),
      },
    },
    scored,
    withSignal,
  };
}

function shareOf(sentiment: SentimentBreakdown, key: SentimentKey): number | null {
  if (key === 'positive') return sentiment.positivePct;
  if (key === 'neutral') return sentiment.neutralPct;
  return sentiment.negativePct;
}

/* ---------------------------------------------------- join-source aggregation */

/** The two join mechanisms, summed over a set of groups. */
export function sourceSplitFor(metrics: GroupWeekMetrics[]): NewMembersBySource {
  const out = {} as NewMembersBySource;
  for (const key of MEMBER_SOURCE_KEYS) {
    out[key] = sumOrNull(metrics.map((m) => m.newMembersBySource[key]));
  }
  return out;
}

/** Chart rows for the join-source split: one row per week, one key per mechanism. */
export function sourceSplitRows(
  data: DashboardData,
  groups: GroupSlug[],
  weeks: string[] = data.weeks,
): TrendRow[] {
  const seriesByGroup = groups.map((slug) => groupSeries(data, slug, weeks));
  return weeks.map((week, index) => {
    const weekMetrics = seriesByGroup
      .map((series) => series[index])
      .filter((m): m is GroupWeekMetrics => m !== undefined);
    const split = sourceSplitFor(weekMetrics);
    const row: TrendRow = { week };
    for (const key of MEMBER_SOURCE_KEYS) row[key] = split[key];
    return row;
  });
}

export const SOURCE_SERIES: { key: MemberSourceKey; label: string }[] =
  MEMBER_SOURCE_KEYS.map((key) => ({ key, label: MEMBER_SOURCE_LABELS[key] }));

/* --------------------------------------------------------------- trend rows */

export function multiGroupRows(
  data: DashboardData,
  metric: MetricKey,
  groups: GroupSlug[],
  weeks: string[] = data.weeks,
): TrendRow[] {
  const seriesByGroup = new Map<GroupSlug, GroupWeekMetrics[]>();
  for (const slug of groups) seriesByGroup.set(slug, groupSeries(data, slug, weeks));

  return weeks.map((week, index) => {
    const row: TrendRow = { week };
    for (const slug of groups) {
      const metrics = seriesByGroup.get(slug)?.[index];
      row[slug] = metrics ? metricOf(metrics, metric) : null;
    }
    return row;
  });
}

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
    case 'messages':
    case 'activeParticipants':
      return sumOrNull(metrics.map((m) => metricOf(m, key)));
    case 'memberGrowthPct': {
      // Growth over the pooled base, not the mean of five growth rates.
      const withBoth = metrics.filter(
        (m) => m.totalMembers !== null && m.newMembers !== null,
      );
      if (withBoth.length === 0) return null;
      const added = withBoth.reduce((s, m) => s + (m.newMembers ?? 0), 0);
      const base = withBoth.reduce(
        (s, m) => s + ((m.totalMembers ?? 0) - (m.newMembers ?? 0)),
        0,
      );
      return pct(added, base);
    }
    case 'pollResponseRatePct': {
      if (!metrics.some((m) => m.pollCount > 0)) return null;
      const responses = metrics.reduce((s, m) => s + m.pollResponses, 0);
      return pct(responses, sumOrNull(metrics.map((m) => m.totalMembers)));
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
    case 'messages':
      return m.messages;
    case 'activeParticipants':
      return m.activeParticipants;
    case 'pollResponseRatePct':
      return m.pollResponseRatePct;
    case 'dmReplyRatePct':
      return m.dmReplyRatePct;
    default:
      return null;
  }
}

/* ------------------------------------------------------- imported figures -- */

export function communityImported(
  data: DashboardData,
  community: CommunitySlug,
  weekStart: string = data.displayWeek,
): ImportedWeek {
  return importedWeek(data.imports, community, weekStart);
}

export function mergedImported(
  data: DashboardData,
  weekStart: string = data.displayWeek,
): ImportedWeek {
  return mergedWeek(data.imports, COMMUNITY_SLUGS, weekStart);
}

/**
 * One imported figure across the trend window, oldest week first.
 *
 * A week with no upload is null, not zero, so a gap in the routine shows as a
 * break in the line rather than as traffic collapsing to nothing.
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

/** Pooled member/message series for a set of groups, for the context charts. */
export function chatSeries(
  data: DashboardData,
  groups: GroupSlug[],
  metric: MetricKey,
  weeks: string[] = data.weeks,
): { week: string; value: number | null }[] {
  const seriesByGroup = groups.map((slug) => groupSeries(data, slug, weeks));
  return weeks.map((week, index) => ({
    week,
    value: pooledMetric(
      seriesByGroup.map((s) => s[index]).filter((m): m is GroupWeekMetrics => m !== undefined),
      metric,
    ),
  }));
}
