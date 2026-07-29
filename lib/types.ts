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

/** The three automated data sources. */
export type IntegrationName = 'sheets' | 'ga4' | 'shortio';

/** The three things the top-level switcher can select. */
export type ScopeSlug = CommunitySlug | 'merged';

export type ActivityLevel = 'Low' | 'Medium' | 'High';

/** Seed values for demo mode. Only used when nothing real is configured. */
export interface DemoProfile {
  /** Member count at the start of the demo window. */
  members: number;
  /** Baseline weekly growth rate, e.g. 0.04 for 4%. */
  growth: number;
  /** Baseline weekly lead count. */
  leads: number;
  /** Universities to sprinkle through demo registrations. */
  universities: string[];
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
  /** Country value as written in the registration sheet. Empty for groups that
   *  are not country-scoped — those are attributed by UTM campaign only. */
  sheetCountry: string[];
  /** UTM campaign(s) that belong to this group — used to filter GA4 + leads. */
  utmCampaigns: string[];
  /** Short.io tag identifying this group's tracked links. */
  shortioTag: string;
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
   * Which automated sources actually represent this community's traffic and
   * signups. Empty means manual-only: none of the pulled data is attributed to
   * this community, and its pages show no integration figures at all.
   *
   * This is THE attribution switch. When a new community starts getting fed by
   * a source, add the source name here — nothing in the integration code needs
   * rewiring.
   */
  integrations: IntegrationName[];
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
 * dashboard; everything in `metrics.ts` is derived from it plus the
 * integration pulls.
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

/* ------------------------------------------------------------- integrations */

/** A registration row pulled from the Google Sheet. */
export interface Registration {
  name: string;
  email: string;
  country: string;
  university: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  /** ISO timestamp. */
  timestamp: string;
}

/** One GA4 day of sessions for a campaign. */
export interface Ga4SessionRow {
  /** YYYY-MM-DD */
  date: string;
  campaign: string;
  source: string;
  medium: string;
  sessions: number;
}

/** Click counts for one tracked Short.io link. */
export interface ShortLinkClicks {
  /** Short.io link id or path. */
  id: string;
  title: string;
  tag: string;
  clicks: number;
  /** Attribution bucket this link belongs to, e.g. "Instagram". */
  source: string;
}

export type IntegrationStatus = 'live' | 'demo' | 'error';

export interface IntegrationState {
  name: IntegrationName;
  label: string;
  status: IntegrationStatus;
  message: string;
  /** ISO timestamp of the pull that produced the current cache. */
  fetchedAt: string;
}

export interface IntegrationSnapshot {
  registrations: Registration[];
  ga4: Ga4SessionRow[];
  shortLinks: ShortLinkClicks[];
  states: IntegrationState[];
  fetchedAt: string;
}

/* ----------------------------------------------------------- derived shapes */

export interface LeadsBySource {
  source: string;
  leads: number;
  clicks: number;
  /** leads / clicks, as a percentage. null when clicks are unknown. */
  conversionRate: number | null;
}

/** Pooled figures for a community, or for every community at once. */
export interface RollupTotals {
  members: number;
  newMembers: number;
  /** Null when no group in scope has Sheets coverage. */
  leads: number | null;
  /** Null when no group in scope has GA4 coverage. */
  sessions: number | null;
  /** Responses ÷ members, pooled across the groups in scope. */
  pollResponseRatePct: number | null;
  /** Replies ÷ DMs sent, pooled. */
  dmReplyRatePct: number | null;
  /** Leads ÷ sessions, pooled. */
  leadConversionPct: number | null;
  groupsWithEntry: number;
  groupCount: number;
}

/** Everything one group needs for one week, manual + auto + derived. */
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

  /**
   * Registrations attributed to this group in this week. Null — not zero —
   * when the group's community declares no Sheets coverage: "we don't measure
   * this here" must stay distinguishable from "we measured zero".
   */
  totalLeads: number | null;
  /** GA4 sessions this week; null when the community declares no GA4 coverage. */
  totalSessions: number | null;
  leadsBySource: LeadsBySource[];
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
  | 'dmReplyRatePct'
  | 'totalLeads'
  | 'totalSessions';
