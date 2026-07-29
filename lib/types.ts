/** Canonical group identifiers. Order here is the order shown everywhere. */
export type GroupSlug = 'uk' | 'usa' | 'australia' | 'canada' | 'germany';

export type ActivityLevel = 'Low' | 'Medium' | 'High';

export interface GroupConfig {
  slug: GroupSlug;
  /** Full name, e.g. "United Kingdom". */
  name: string;
  /** Short label used in the sidebar, cards and table rows. */
  label: string;
  flag: string;
  /** Country value as written in the registration sheet. */
  sheetCountry: string[];
  /** UTM campaign(s) that belong to this group — used to filter GA4 + leads. */
  utmCampaigns: string[];
  /** Short.io tag identifying this group's tracked links. */
  shortioTag: string;
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
  name: 'sheets' | 'ga4' | 'shortio';
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

/** Everything one group needs for one week, manual + auto + derived. */
export interface GroupWeekMetrics {
  group: GroupSlug;
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

  /** Registrations attributed to this group in this week. */
  totalLeads: number;
  /** GA4 sessions attributed to this group's campaigns in this week. */
  totalSessions: number;
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
