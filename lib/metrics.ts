import type {
  ActivityLevel,
  GroupSlug,
  GroupWeekMetrics,
  MetricKey,
  NewMembersBySource,
  Poll,
  PollHistoryRow,
  SentimentBreakdown,
  WeeklyEntry,
} from './types';
import { getGroup } from './groups';
import { lastNWeeks, previousWeek } from './weeks';
import { chatWeekFor, type ChatRecordLike } from './whatsapp/select';
import type { WhatsAppWeek } from './whatsapp/analyse';

/**
 * Chat records are typed structurally here, not as the store's concrete type: the
 * store imports node:fs, and this module is pulled into the client bundle for its
 * formatters.
 */
type GroupChatImport = ChatRecordLike;

/**
 * Every derived number in the dashboard is computed here.
 *
 * TWO INPUTS, and the split between them is the whole design:
 *
 *   1. The chat export, analysed into per-week figures — members, growth, join
 *      mechanism, activity, topics, questions, sentiment.
 *   2. Weekly entries, which now hold ONLY poll counts and DM figures, because
 *      WhatsApp exports contain the poll question but never the votes, and a
 *      group export contains no 1:1 threads at all.
 *
 * Nothing here invents a value. A group-week with no chat export gets nulls, not
 * zeros: "no export covers this week" and "nothing happened" are different facts.
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

/* --------------------------------------------------------- the main assembler */

const EMPTY_SENTIMENT: SentimentBreakdown = {
  positivePct: null,
  neutralPct: null,
  negativePct: null,
  examples: { positive: [], neutral: [], negative: [] },
};

/** Chat-derived + manual, for one group and one week. */
export function buildGroupWeekMetrics(
  group: GroupSlug,
  weekStart: string,
  entries: WeeklyEntry[],
  chatImports: GroupChatImport[],
): GroupWeekMetrics {
  const entry = entries.find((e) => e.group === group && e.weekStart === weekStart) ?? null;
  const chat = chatWeekFor(chatImports, group, weekStart);

  // The most recent earlier week the export covers — not strictly weekStart-1, so
  // a quiet week with no messages doesn't wipe out the growth figure.
  const record = chatImports.find((r) => r.group === group);
  const previousChat =
    [...(record?.weeks ?? [])]
      .filter((w) => w.weekStart < weekStart && w.members !== null)
      .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))[0] ?? null;

  const responses = entry ? pollResponses(entry.polls) : 0;
  const members = chat?.members ?? null;
  const previousMembers = previousChat?.members ?? null;

  return {
    group,
    community: getGroup(group)?.community ?? 'community-1',
    weekStart,
    entry,
    chat,

    totalMembers: members,
    // Net change is always derivable from the export's join/leave lines, even
    // when an absolute headcount isn't.
    newMembers: chat?.netChange ?? null,
    memberGrowthPct:
      members !== null && previousMembers !== null && previousMembers > 0
        ? ((members - previousMembers) / previousMembers) * 100
        : null,
    newMembersBySource: sourceSplitOf(chat),

    messages: chat?.messages ?? null,
    activeParticipants: chat?.activeParticipants ?? null,

    pollResponses: responses,
    pollCount: entry?.polls.length ?? 0,
    // Denominator from the export, numerator from the form — the one place the two
    // inputs meet. Null unless a poll was actually recorded: with no poll, "0
    // responses out of 400 members" is not a 0% response rate, it is no rate at
    // all, and 0.0% on the tile reads as terrible engagement rather than as a
    // missing entry.
    pollResponseRatePct:
      entry && entry.polls.length > 0 ? pct(responses, members) : null,

    dmsSent: entry?.dmsSent ?? 0,
    dmReplies: entry?.dmReplies ?? 0,
    dmReplyRatePct: entry ? pct(entry.dmReplies, entry.dmsSent) : null,

    activityLevel: chat?.activityLevel ?? null,
    topics: chat?.topics ?? [],
    questions: chat?.questions ?? [],
    sentiment: chat
      ? {
          positivePct: chat.sentiment.positivePct,
          neutralPct: chat.sentiment.neutralPct,
          negativePct: chat.sentiment.negativePct,
          examples: chat.sentiment.examples,
        }
      : EMPTY_SENTIMENT,
    sentimentScored: chat?.sentiment.scored ?? 0,
    sentimentWithSignal: chat?.sentiment.withSignal ?? 0,
  };
}

/** The two join mechanisms WhatsApp distinguishes; null when no export covers the week. */
function sourceSplitOf(chat: WhatsAppWeek | null): NewMembersBySource {
  if (!chat) return { inviteLink: null, addedByAdmin: null };
  return { inviteLink: chat.joinedViaLink, addedByAdmin: chat.addedByAdmin };
}

/** The same metrics across a window of weeks, oldest first. */
export function buildGroupSeries(
  group: GroupSlug,
  weeks: string[],
  entries: WeeklyEntry[],
  chatImports: GroupChatImport[],
): GroupWeekMetrics[] {
  return weeks.map((week) => buildGroupWeekMetrics(group, week, entries, chatImports));
}

/** Poll history for a group, newest week first, one row per poll. */
export function buildPollHistory(
  entries: WeeklyEntry[],
  group: GroupSlug,
  chatImports: GroupChatImport[],
): PollHistoryRow[] {
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
          // Members come from the export for that week, so the rate is null when
          // no export covers it rather than being computed against a guess.
          responseRatePct: pct(responses, chatWeekFor(chatImports, group, entry.weekStart)?.members ?? null),
        };
      }),
    );
}

/**
 * The week to show by default: the most recent week any source has data for,
 * falling back to the current week when nothing is imported at all.
 */
export function latestWeekWithData(
  entries: WeeklyEntry[],
  chatImports: GroupChatImport[],
  fallback: string,
): string {
  const weeks: string[] = [
    ...entries.map((e) => e.weekStart),
    ...chatImports.flatMap((r) => r.weeks.map((w) => w.weekStart)),
  ];
  if (weeks.length === 0) return fallback;
  return weeks.reduce((latest, w) => (w > latest ? w : latest), weeks[0]);
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
  /** Which input supplies it, so a reader knows what to fix when it's empty. */
  from: 'chat export' | 'weekly form';
}

export const METRIC_DEFS: MetricDef[] = [
  {
    key: 'totalMembers',
    label: 'Total members',
    shortLabel: 'Members',
    unit: 'count',
    description: 'Members at the end of the week, counted from the export’s join and leave lines',
    from: 'chat export',
  },
  {
    key: 'newMembers',
    label: 'Net new members',
    shortLabel: 'Net new',
    unit: 'count',
    description: 'Joins minus departures during the week',
    from: 'chat export',
  },
  {
    key: 'memberGrowthPct',
    label: 'Member growth',
    shortLabel: 'Growth %',
    unit: 'percent',
    description: 'Week-over-week change in member count',
    from: 'chat export',
  },
  {
    key: 'messages',
    label: 'Messages',
    shortLabel: 'Messages',
    unit: 'count',
    description: 'Messages sent in the group that week, excluding attachments',
    from: 'chat export',
  },
  {
    key: 'activeParticipants',
    label: 'Active members',
    shortLabel: 'Active',
    unit: 'count',
    description: 'People who sent at least one message. Identities are not retained',
    from: 'chat export',
  },
  {
    key: 'pollResponseRatePct',
    label: 'Poll response rate',
    shortLabel: 'Poll rate',
    unit: 'percent',
    description: 'Poll responses ÷ member count. Votes are not in the export, so responses are typed',
    from: 'weekly form',
  },
  {
    key: 'dmReplyRatePct',
    label: 'DM reply rate',
    shortLabel: 'DM reply',
    unit: 'percent',
    description: 'Replies ÷ 1:1 DMs sent. A group export contains no DMs, so both are typed',
    from: 'weekly form',
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

export function activityLabel(level: ActivityLevel | null): string {
  return level ?? '—';
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
