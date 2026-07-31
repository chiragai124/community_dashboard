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
 * The two file-import sources. Each corresponds to one export the user
 * downloads weekly and uploads here. There are no API connections.
 */
export type ImportSource = 'shortio' | 'ga4';

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
 * A single manual weekly entry. This is the only hand-typed data in the
 * dashboard; everything in `metrics.ts` is derived from it plus the imports.
 */
export interface WeeklyEntry {
  id: string;
  group: GroupSlug;
  /** ISO week start, always a Monday, as YYYY-MM-DD. */
  weekStart: string;
  totalMembers: number;
  /**
   * New members this week. Optional: when omitted it is derived as the delta
   * against the previous week's `totalMembers`.
   */
  newMembersOverride?: number | null;
  polls: Poll[];
  dmsSent: number;
  dmReplies: number;
  activityLevel: ActivityLevel;
  /** Why the activity level is what it is — sits beside the badge. */
  activityNote: string;
  /** What the week was mostly about, e.g. ['Scholarships', 'Visa process']. */
  mainTopics: string[];
  /** What students asked most that week, one entry per question. */
  commonQuestions: string[];
  /** How students responded to posted content — polls, announcements, media. */
  contentResponse: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** Payload accepted by POST/PUT /api/entries. */
export interface WeeklyEntryInput {
  group: GroupSlug;
  weekStart: string;
  totalMembers: number;
  newMembersOverride?: number | null;
  polls?: Poll[];
  dmsSent?: number;
  dmReplies?: number;
  activityLevel?: ActivityLevel;
  activityNote?: string;
  mainTopics?: string[];
  commonQuestions?: string[];
  contentResponse?: string;
  notes?: string;
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
  members: number;
  newMembers: number;
  /** Responses ÷ members, pooled across the groups in scope. */
  pollResponseRatePct: number | null;
  /** Replies ÷ DMs sent, pooled. */
  dmReplyRatePct: number | null;
  groupsWithEntry: number;
  groupCount: number;
}

/** Everything one group needs for one week. All of it manual. */
export interface GroupWeekMetrics {
  group: GroupSlug;
  community: CommunitySlug;
  weekStart: string;
  entry: WeeklyEntry | null;
  /** Previous week's entry, when one exists. */
  previousEntry: WeeklyEntry | null;

  totalMembers: number | null;
  newMembers: number | null;
  /** Week-over-week member growth, as a percentage. */
  memberGrowthPct: number | null;

  pollResponses: number;
  pollCount: number;
  /** responses / members, as a percentage. */
  pollResponseRatePct: number | null;

  dmsSent: number;
  dmReplies: number;
  /** replies / DMs sent, as a percentage. */
  dmReplyRatePct: number | null;

  activityLevel: ActivityLevel | null;
  notes: string;
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

/** One row per week for the multi-series charts: `week` plus a key per group. */
export interface TrendRow {
  week: string;
  [seriesKey: string]: number | string | null;
}

export type MetricKey =
  | 'totalMembers'
  | 'newMembers'
  | 'memberGrowthPct'
  | 'pollResponseRatePct'
  | 'dmReplyRatePct';
