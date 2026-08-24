/**
 * Canonical group identifiers, across every community. Slugs are globally
 * unique, so a group always identifies exactly one community and stored
 * figures need no community column of their own.
 */
export type GroupSlug =
  // Community #1 — destination groups
  | 'uk'
  | 'usa'
  | 'australia'
  | 'canada'
  | 'germany'
  // Community #2 — amber global aspirants #2 | 2026 Intake — same five
  // destinations, tracked as their own community's groups (distinct slugs:
  // group slugs are globally unique, so Community #1's 'uk' and Community
  // #2's 'uk' can't be the same value).
  | 'uk-2'
  | 'usa-2'
  | 'australia-2'
  | 'canada-2'
  | 'germany-2'
  // Community #3 — same five destinations again, distinct slugs.
  | 'uk-3'
  | 'usa-3'
  | 'australia-3'
  | 'canada-3'
  | 'germany-3';

/** Top-level communities. Each is its own report. */
export type CommunitySlug = 'community-1' | 'community-2' | 'community-3';

/**
 * The three file-import sources. Each corresponds to one export the user
 * downloads and uploads here. There are no API connections other than the
 * Groq call made server-side from an already-uploaded WhatsApp export (see
 * lib/ai/groq.ts) — chat text is sent nowhere else.
 *
 * Short.io and GA4 are community-level snapshots: one file per community per
 * week. WhatsApp is per-group and is the group's full chat history re-exported
 * each time — see lib/imports/whatsapp.ts for why that matters.
 */
export type ImportSource = 'shortio' | 'ga4' | 'whatsapp';

/** The scopes the top-level nav can select: Overview, one community, or the landing page. */
export type ScopeSlug = 'overview' | CommunitySlug | 'merged';

export type ActivityLevel = 'Low' | 'Medium' | 'High';

export interface GroupConfig {
  slug: GroupSlug;
  /** The community this group belongs to. */
  community: CommunitySlug;
  /** Full name, e.g. "United Kingdom". */
  name: string;
  /** Short label used in the nav, cards and table rows. */
  label: string;
  flag: string;
}

/**
 * A community: a WhatsApp community tracked as its own report, with its own
 * overview, metrics and groups. Communities never nest.
 */
export interface CommunityConfig {
  slug: CommunitySlug;
  /** Full name, shown in page headers. */
  name: string;
  /** Short label for the nav tab and table rows. */
  label: string;
  /** One line describing what the community is. */
  description: string;
  /** What this community calls its subdivisions — "Groups" or "Segments". */
  groupNoun: string;
  /**
   * Which exports can be imported for this community. Imported figures are
   * community-level, not per group: one Short.io and one GA4 file per week.
   */
  imports: ImportSource[];
  groups: GroupConfig[];
}

/* ------------------------------------------------------------- sentiment -- */

export type SentimentKey = 'positive' | 'neutral' | 'negative';

export const SENTIMENT_KEYS: SentimentKey[] = ['positive', 'neutral', 'negative'];

/**
 * Auto-computed sentiment for a group-week, with example messages.
 *
 * Percentages are NOT normalised to 100 — some messages classify to none of
 * the three buckets, so the bar is left short rather than rescaled.
 */
export interface SentimentBreakdown {
  positivePct: number | null;
  neutralPct: number | null;
  negativePct: number | null;
  /** Up to three example message snippets per sentiment. */
  examples: Record<SentimentKey, string[]>;
}

/** All-null/empty sentiment, for a group-week with no WhatsApp import yet. */
export function emptySentiment(): SentimentBreakdown {
  return {
    positivePct: null,
    neutralPct: null,
    negativePct: null,
    examples: { positive: [], neutral: [], negative: [] },
  };
}

/** One person's message count within a group-week — the "top voices" list. */
export interface Voice {
  name: string;
  count: number;
}

/**
 * The AI-generated pieces of a group's weekly report: a short status tag, a
 * one-line gloss on who's driving the conversation, and a narrative paragraph
 * on what people are actually talking about. Generated server-side from that
 * week's real chat text via Groq (see lib/ai/groq.ts) — omitted entirely when
 * no GROQ_API_KEY is configured or the call fails, rather than faked.
 */
export interface AiSummary {
  /** e.g. "Most Active", "On-topic", "Silent", "Low". */
  statusTag: string;
  topVoicesSummary: string;
  narrative: string;
  generatedAt: string;
}

/**
 * What one manually-dated period of a WhatsApp chat export contributes to
 * one group. Every figure here is auto-computed by lib/imports/whatsapp.ts
 * from messages within the filed date range — nothing here is hand-typed.
 *
 * There is deliberately no member count here: WhatsApp exports don't
 * reliably contain a group's full join/leave history (older events can be
 * missing from an export depending on how far back WhatsApp retains them),
 * so a replay-based total silently undercounts. Total membership is tracked
 * separately as a manual entry per community — see CommunityMemberEntry.
 */
export interface WhatsappFigures {
  messageCount: number;
  /** Distinct senders who posted at least one message this period. */
  uniqueActiveChatters: number;
  /** Top senders by message count this period, most first. */
  topVoices: Voice[];
  /** Relative to this group's own previous filed period, not a fixed threshold. */
  activityLevel: ActivityLevel;
  /** Ranked most-mentioned first — `mainTopics[0]` is the period's trending topic. */
  mainTopics: string[];
  /** How many times `mainTopics[0]` was mentioned, or null when there were no topics at all. */
  topTopicMentions: number | null;
  sentiment: SentimentBreakdown;
}

/**
 * One uploaded file. Three different scopes, one per source:
 *
 *   - Short.io is Community #2's own link data specifically — not shared,
 *     not generic. `community` is always `'community-2'` for this source
 *     (enforced by `lib/groups.ts` only declaring the `shortio` capability
 *     there). `source` + `community` + `weekStart` is its natural key.
 *   - GA4 is landing-page traffic — it isn't anyone's community data, so
 *     `community` is omitted entirely. `source` + `weekStart` is its natural
 *     key (see `importIdForGlobal`).
 *   - WhatsApp is per-group (`group` is set, `community` follows from it):
 *     each upload is filed under the manually-entered `periodStart`/
 *     `periodEnd` range — see lib/imports/whatsapp.ts and the imports API
 *     route.
 *
 * Whichever scope applies, re-uploading the same export for the same
 * week/period replaces its numbers rather than adding to them.
 */
export interface ImportedFile {
  id: string;
  source: ImportSource;
  /** Omitted for GA4 (landing-page data, not community-scoped). */
  community?: CommunitySlug;
  /** Set only when source === 'whatsapp'; a group identifies its community. */
  group?: GroupSlug;
  /** Short.io / GA4 only: the Monday-anchored week this snapshot is filed under. */
  weekStart?: string;
  /**
   * WhatsApp only: the manually-entered inclusive date range this report
   * covers — not necessarily seven days, not necessarily Monday-aligned. The
   * chat export itself may span a much wider history (needed to replay
   * member totals accurately); only messages inside [periodStart, periodEnd]
   * count toward this report's message-level figures.
   */
  periodStart?: string;
  periodEnd?: string;
  filename: string;
  uploadedAt: string;
  /**
   * Where each figure was found, in plain words — which sheet, which report
   * section, or (for WhatsApp) what the parser counted. Shown next to the
   * numbers so any surprising value can be traced back to the file without
   * opening it.
   */
  notes: string[];
  shortio?: ShortioFigures;
  ga4?: Ga4Figures;
  whatsapp?: WhatsappFigures;
  /** Set only for the most recent week of a WhatsApp upload — see the imports API route. */
  aiSummary?: AiSummary;
}

/** Clicks on one tracked link, from Short.io's "Top links" sheet. */
export interface LinkClicks {
  /** The link path as Short.io reports it, e.g. "/scholarship-teamB". */
  path: string;
  clicks: number;
}

/** What one Short.io workbook contributes. */
export interface ShortioFigures {
  totalClicks: number;
  links: LinkClicks[];
}

/** What one GA4 reports-snapshot CSV contributes. */
export interface Ga4Figures {
  activeUsers: number | null;
  newUsers: number | null;
  sessions: number | null;
}

/* ----------------------------------------------------------- derived shapes */

/** Pooled message-level figures for a community, or for every community at once. */
export interface RollupTotals {
  messageCount: number;
  /** Sum of each group's own unique-chatter count — an upper bound, not a true cross-group union. */
  uniqueActiveChatters: number;
  /** How many groups have a WhatsApp import for their current period (drives every figure above). */
  groupsWithEntry: number;
  groupCount: number;
}

/**
 * One manually-entered "total members" reading for a community, with the
 * date it was entered as of. Communities keep a full history of these (one
 * append-only log per community), so "vs. last entry" is always answerable
 * and nothing is overwritten. See lib/community-members.ts.
 */
export interface CommunityMemberEntry {
  community: CommunitySlug;
  total: number;
  /** The date this count is as of — manually chosen, defaults to today. */
  enteredAt: string;
  /** When the entry was actually saved — for "entered 2 days ago" style display. */
  recordedAt: string;
}

/**
 * Everything one group needs for its most recently filed report period —
 * entirely auto-computed from its WhatsApp export (see
 * lib/imports/whatsapp.ts) for the manually-entered date range it was filed
 * under, plus an AI-generated status tag/summary/narrative (see
 * lib/ai/groq.ts). Nothing here is hand-typed except the date range itself.
 *
 * Deliberately carries no member count — total membership is tracked at the
 * community level as a manual entry, not per group. See CommunityMemberEntry.
 */
export interface GroupPeriodMetrics {
  group: GroupSlug;
  community: CommunitySlug;
  /** Null when no period has ever been filed for this group. */
  periodStart: string | null;
  periodEnd: string | null;
  /** True when a WhatsApp export has been parsed for this group's latest period. */
  hasWhatsapp: boolean;

  messageCount: number | null;
  uniqueActiveChatters: number | null;
  topVoices: Voice[];

  /** Auto-computed from message volume vs. this group's previous filed period. */
  activityLevel: ActivityLevel | null;
  /** Auto-extracted from this period's messages, ranked most-mentioned first. */
  mainTopics: string[];
  /** How many times mainTopics[0] was mentioned — the trending-topic count. */
  topTopicMentions: number | null;
  /** Auto-computed sentiment split and example messages. */
  sentiment: SentimentBreakdown;

  /** Present only when Groq generated a summary for this group's latest period. */
  aiSummary: AiSummary | null;
}

/** One row per x-axis category (a week, for GA4/Short.io; unused by WhatsApp charts now). */
export interface TrendRow {
  week: string;
  [seriesKey: string]: number | string | null;
}

/** A community-level synthesis across its groups' latest periods — see lib/ai/groq.ts. */
export interface CommunitySummary {
  mainTopics: string[];
  narrative: string;
  generatedAt: string;
}
