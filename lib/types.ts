/**
 * Canonical group identifiers, across every community. Slugs are globally
 * unique, so a group always identifies exactly one community and stored entries
 * need no community column of their own.
 */
export type GroupSlug =
  // Community #1 — destination groups
  | 'uk'
  | 'usa'
  | 'australia'
  | 'canada'
  | 'germany'
  // Community #2 — amber global aspirants #2 | 2026 Intake
  | 'aspirants-2026';

/** Top-level communities. Each is its own report. */
export type CommunitySlug = 'community-1' | 'community-2';

/**
 * The three file-import sources. Each corresponds to one export the user
 * downloads and uploads here. There are no API connections.
 *
 * `shortio` and `ga4` are community-level (one file each per week). `whatsapp` is
 * per GROUP, because a chat export is one group's transcript — and it carries a
 * whole history, so one upload backfills every week it covers.
 */
export type ImportSource = 'shortio' | 'ga4' | 'whatsapp';

/** The three things the top-level switcher can select. */
export type ScopeSlug = CommunitySlug | 'merged';

export type ActivityLevel = 'Low' | 'Medium' | 'High';

/** Seed values for demo mode. Only used when nothing real is configured. */
export interface DemoProfile {
  /** Member count at the start of the demo window. */
  members: number;
  /** Baseline weekly growth rate, e.g. 0.04 for 4%. */
  growth: number;
}

export interface GroupConfig {
  slug: GroupSlug;
  /** The community this group belongs to. */
  community: CommunitySlug;
  /** Full name, e.g. "United Kingdom". */
  name: string;
  /** Short label used in the sidebar, cards and table rows. */
  label: string;
  flag: string;
  demo: DemoProfile;
}

/**
 * A community: a WhatsApp community tracked as its own report, with its own
 * overview, metrics and groups. Communities never nest.
 */
export interface CommunityConfig {
  slug: CommunitySlug;
  /** Full name, shown in page headers. */
  name: string;
  /** Short label for the sidebar switcher and table rows. */
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
 * Sentiment for a group-week, computed from the chat export by
 * lib/whatsapp/sentiment.ts.
 *
 * Percentages are shares of the messages scored, so they sum to 100 by
 * construction. The UI still states how many messages carried a recognised
 * sentiment word, because a mostly-neutral week is a fact about the method as
 * much as about the group.
 */
export interface SentimentBreakdown {
  positivePct: number | null;
  neutralPct: number | null;
  negativePct: number | null;
  /** Up to three example message snippets per sentiment. */
  examples: Record<SentimentKey, string[]>;
}

/* --------------------------------------------------- new members by source */

/**
 * How a week's new members arrived, read from the chat export's system lines.
 *
 * These are the ONLY two mechanisms WhatsApp distinguishes. It records that
 * someone "joined using this group's invite link" or that an admin "added" them —
 * but never WHICH link was clicked, so a Short.io-versus-landing-page split is not
 * recoverable from any of the three files. Clicks and sessions are shown beside
 * this as context, never apportioned into it.
 */
export type MemberSourceKey = 'inviteLink' | 'addedByAdmin';

export const MEMBER_SOURCE_KEYS: MemberSourceKey[] = ['inviteLink', 'addedByAdmin'];

export const MEMBER_SOURCE_LABELS: Record<MemberSourceKey, string> = {
  inviteLink: 'Joined via invite link',
  addedByAdmin: 'Added by an admin',
};

/** Null per source means "no export covers this week", never "zero from this source". */
export type NewMembersBySource = Record<MemberSourceKey, number | null>;

/** One poll posted in a group during a week. */
export interface Poll {
  question: string;
  /** option label -> response count */
  options: PollOption[];
}

export interface PollOption {
  label: string;
  count: number;
}

/**
 * The only hand-typed data left in the dashboard: the three things no export
 * contains.
 *
 * WhatsApp exports carry the poll QUESTION but never the votes, and a group
 * export contains no 1:1 threads at all — so poll counts and DM figures cannot be
 * derived from any of the three files. Everything else (members, growth, activity,
 * topics, questions, sentiment, join source) now comes from the imports.
 */
export interface WeeklyEntry {
  id: string;
  group: GroupSlug;
  /** ISO week start, always a Monday, as YYYY-MM-DD. */
  weekStart: string;
  polls: Poll[];
  dmsSent: number;
  dmReplies: number;
  createdAt: string;
  updatedAt: string;
}

/** Payload accepted by POST /api/entries. */
export interface WeeklyEntryInput {
  group: GroupSlug;
  weekStart: string;
  polls?: Poll[];
  dmsSent?: number;
  dmReplies?: number;
}

/* --------------------------------------------------------- imported figures */

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

/**
 * One uploaded file.
 *
 * `source` + `community` + `weekStart` is the natural key, so re-uploading the
 * same export for the same week replaces that week's numbers rather than adding
 * to them — upload the same file twice and nothing doubles.
 */
export interface ImportedFile {
  id: string;
  source: ImportSource;
  community: CommunitySlug;
  /** ISO week start (Monday) the figures are filed under. */
  weekStart: string;
  filename: string;
  uploadedAt: string;
  /**
   * Where each figure was found, in plain words — which sheet or which report
   * section. Shown next to the numbers so any surprising value can be traced
   * back to the file without opening it.
   */
  notes: string[];
  shortio?: ShortioFigures;
  ga4?: Ga4Figures;
}

/** The figures for one community and week, from however many files. */
export interface ImportedWeek {
  weekStart: string;
  shortio: ShortioFigures | null;
  ga4: Ga4Figures | null;
}

/* ----------------------------------------------------------- derived shapes */

/** Pooled figures for a community, or for every community at once. */
export interface RollupTotals {
  /** Null when no chat export covers the week for any group in scope. */
  members: number | null;
  newMembers: number | null;
  messages: number | null;
  activeParticipants: number | null;
  /** Responses ÷ members, pooled across the groups in scope. */
  pollResponseRatePct: number | null;
  /** Replies ÷ DMs sent, pooled. */
  dmReplyRatePct: number | null;
  /** Groups with a chat export covering this week, and groups in scope. */
  groupsWithChat: number;
  groupCount: number;
}

/** One extracted term or phrase, with how many messages used it. */
export interface TopicTerm {
  term: string;
  messages: number;
  score: number;
}

/** One question shape, and how often it was asked. */
export interface CommonQuestion {
  text: string;
  asked: number;
}

/**
 * Everything one group needs for one week.
 *
 * Almost all of it comes from the chat export. Only `pollResponses`/`pollCount`
 * and the DM figures come from the weekly form, because neither poll votes nor
 * 1:1 threads are present in any export.
 */
export interface GroupWeekMetrics {
  group: GroupSlug;
  community: CommunitySlug;
  weekStart: string;
  /** The week's manual entry (polls + DMs only), when one exists. */
  entry: WeeklyEntry | null;
  /** The week's chat-derived figures, when an export covers it. */
  chat: unknown;

  totalMembers: number | null;
  newMembers: number | null;
  memberGrowthPct: number | null;
  /** Joins via invite link vs added by an admin. */
  newMembersBySource: NewMembersBySource;

  messages: number | null;
  activeParticipants: number | null;

  pollResponses: number;
  pollCount: number;
  pollResponseRatePct: number | null;

  dmsSent: number;
  dmReplies: number;
  dmReplyRatePct: number | null;

  activityLevel: ActivityLevel | null;
  topics: TopicTerm[];
  questions: CommonQuestion[];
  sentiment: SentimentBreakdown;
  /** Messages scored, and how many carried a recognised sentiment word. */
  sentimentScored: number;
  sentimentWithSignal: number;
}

export interface PollHistoryRow {
  weekStart: string;
  question: string;
  responses: number;
  topAnswer: string;
  topAnswerCount: number;
  /** responses / member count that week, as a percentage. */
  responseRatePct: number | null;
}

/* ----------------------------------------------------------------- leads -- */

/**
 * One hand-entered lead.
 *
 * PERSONAL DATA. Name, email and phone are identifying, so these rows live only
 * in data/leads.json (gitignored) and are never sent anywhere.
 *
 * Still hand-entered because nothing in the three exports identifies a lead: GA4
 * reports sessions, Short.io reports clicks, and a WhatsApp join is a member, not
 * a registration. University and country in particular appear in none of them.
 */
export interface Lead {
  id: string;
  group: GroupSlug;
  name: string;
  email: string;
  phone: string;
  university: string;
  country: string;
  weekStart: string;
  createdAt: string;
}

/** Payload accepted by POST /api/leads — one lead, or a pasted block of rows. */
export interface LeadInput {
  group: GroupSlug;
  weekStart: string;
  name?: string;
  email?: string;
  phone?: string;
  university?: string;
  country?: string;
}

/** One row of a leads breakdown — by university, or by country. */
export interface LeadBreakdownRow {
  label: string;
  leads: number;
  /** Share of the leads in scope, as a percentage. */
  sharePct: number;
}

/** One row per week for the multi-series charts: `week` plus a key per group. */
export interface TrendRow {
  week: string;
  [seriesKey: string]: number | string | null;
}

export type MetricKey =
  | 'totalMembers'
  | 'newMembers'
  | 'memberGrowthPct'
  | 'messages'
  | 'activeParticipants'
  | 'pollResponseRatePct'
  | 'dmReplyRatePct';
