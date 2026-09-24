import { COMMUNITIES, getGroup, groupsOf } from './groups';
import {
  getImports,
  groupPeriodFor,
  groupPeriods,
  resolveGa4,
  resolveShortio,
  type ResolvedImport,
} from './imports';
import { buildGroupPeriodMetrics } from './metrics';
import {
  communityMembersEnteredFor,
  communityMembersFor,
  getCommunityMemberEntries,
  type CommunityMemberEntry,
} from './community-members';
import {
  communityLeadsFor,
  getCommunityLeadEntries,
  type CommunityLeadEntry,
} from './community-leads';
import {
  getInstagramChannel,
  getInstagramMemberEntries,
  instagramMembersEnteredFor,
  instagramMembersFor,
  type InstagramChannel,
  type InstagramMemberEntry,
} from './instagram';
import {
  findReport,
  getActivePeriod,
  getReports,
  parsePeriodId,
  previousReport,
  samePeriod,
  upsertReport,
  type FiledReport,
  type CommunityReportLine,
  type GroupReportLine,
  type ReportPeriod,
  type ReportSnapshot,
} from './reports';
import type {
  CommunitySlug,
  Ga4Figures,
  GroupPeriodMetrics,
  GroupSlug,
  ImportedFile,
  RollupTotals,
  ShortioFigures,
} from './types';

/**
 * One loader shared by every page, and one date range shared by every
 * section of it.
 *
 * The dashboard used to run on three different clocks at once: WhatsApp on
 * whatever range each group's last upload happened to use, Short.io and GA4
 * on their own Monday-anchored weeks, member counts on whenever someone last
 * typed one in. A single page could show four different time spans without
 * saying so. Now there is exactly one period — the active one, or a past
 * report being browsed — and every figure on the page answers for it.
 *
 * Anything that can't answer for it says why: a group with no export filed
 * for the period reports nothing rather than its last known numbers, and
 * Short.io/GA4 figures carry the provenance of whichever export was used (see
 * lib/imports/resolve.ts).
 */

export interface DashboardData {
  /** The date range every figure on the page answers for. */
  period: ReportPeriod;
  /** False when a past report is being browsed rather than the current period. */
  isActivePeriod: boolean;
  /** The active period, whatever is being viewed — for "back to current" links. */
  activePeriod: ReportPeriod;
  /** Every filed report, oldest first — the past-reports picker. */
  reports: FiledReport[];
  /** This period's own filed record, if it has one yet. */
  current: FiledReport | null;
  /** The baseline for every "vs. last report" figure on the page. */
  previous: FiledReport | null;

  imports: ImportedFile[];
  perGroup: GroupPeriodMetrics[];

  memberEntries: CommunityMemberEntry[];
  leadEntries: CommunityLeadEntry[];
  instagramEntries: InstagramMemberEntry[];
  instagramChannel: InstagramChannel;

  ga4: ResolvedImport<Ga4Figures>;
  shortio: ResolvedImport<ShortioFigures>;
}

/**
 * `periodParam` is a `start:end` id from the past-reports picker. Anything
 * unparseable falls back to the active period rather than erroring — a stale
 * or hand-edited URL should show the current report, not a broken page.
 */
export async function loadDashboard(periodParam?: string | null): Promise<DashboardData> {
  const [activePeriod, reports, imports, memberEntries, leadEntries, instagramEntries, instagramChannel] =
    await Promise.all([
      getActivePeriod(),
      getReports(),
      getImports(),
      getCommunityMemberEntries(),
      getCommunityLeadEntries(),
      getInstagramMemberEntries(),
      getInstagramChannel(),
    ]);

  const period = parsePeriodId(periodParam) ?? activePeriod;

  const perGroup = COMMUNITIES.flatMap((c) => c.groups).map((g) =>
    buildGroupPeriodMetrics(g.slug, groupPeriodFor(imports, g.slug, period)),
  );

  return {
    period,
    isActivePeriod: samePeriod(period, activePeriod),
    activePeriod,
    reports,
    current: findReport(reports, period),
    previous: previousReport(reports, period),
    imports,
    perGroup,
    memberEntries,
    leadEntries,
    instagramEntries,
    instagramChannel,
    ga4: resolveGa4(imports, period),
    shortio: resolveShortio(imports, 'community-2', period),
  };
}

/* --------------------------------------------------------------- selectors */

/** Current metrics for one community's groups, in display order. */
export function groupsInCommunity(
  data: DashboardData,
  community: CommunitySlug,
): GroupPeriodMetrics[] {
  const order = groupsOf(community).map((g) => g.slug);
  return order
    .map((slug) => data.perGroup.find((m) => m.group === slug))
    .filter((m): m is GroupPeriodMetrics => m !== undefined);
}

/** Every filed period for one group, oldest first — for the group page's message trend. */
export function groupPeriodSeries(data: DashboardData, group: GroupSlug): GroupPeriodMetrics[] {
  return groupPeriods(data.imports, group).map((period) =>
    buildGroupPeriodMetrics(group, period),
  );
}

/* --------------------------------------------------------- roll-ups & series */

/** Pooled message-level totals over any set of groups — every count simply sums. */
export function rollup(metrics: GroupPeriodMetrics[]): RollupTotals {
  return {
    messageCount: metrics.reduce((s, m) => s + (m.messageCount ?? 0), 0),
    // Sum of each group's own unique-chatter count — an upper bound, not a
    // true cross-group union (raw sender identities aren't kept once a
    // group's figures are computed and persisted).
    uniqueActiveChatters: metrics.reduce((s, m) => s + (m.uniqueActiveChatters ?? 0), 0),
    groupsWithEntry: metrics.filter((m) => m.hasWhatsapp).length,
    groupCount: metrics.length,
  };
}

/** Pooled totals for one community. */
export function communityTotals(data: DashboardData, community: CommunitySlug): RollupTotals {
  return rollup(groupsInCommunity(data, community));
}

/** Per-community roll-ups, in registry order. */
export function perCommunityTotals(
  data: DashboardData,
): { community: CommunitySlug; totals: RollupTotals }[] {
  return COMMUNITIES.map((c) => ({ community: c.slug, totals: communityTotals(data, c.slug) }));
}

/** This community's busiest and quietest group by message count this period, if any have data. */
export function activityExtremes(
  metrics: GroupPeriodMetrics[],
): { busiest: GroupPeriodMetrics | null; quietest: GroupPeriodMetrics | null } {
  const withMessages = metrics.filter((m) => m.messageCount !== null);
  if (withMessages.length === 0) return { busiest: null, quietest: null };
  const sorted = [...withMessages].sort((a, b) => (b.messageCount ?? 0) - (a.messageCount ?? 0));
  return { busiest: sorted[0], quietest: sorted[sorted.length - 1] };
}

/* ------------------------------------------------------------ member totals */

/**
 * One community's member total for this period: its own entry, or the most
 * recent earlier one carried forward (a member total is a level, so last
 * period's reading stands until a newer one is entered).
 */
export function communityMembers(
  data: DashboardData,
  community: CommunitySlug,
): CommunityMemberEntry | null {
  return communityMembersFor(data.memberEntries, community, data.period);
}

/** The total entered for exactly this period — what the entry form pre-fills. */
export function communityMembersEntered(
  data: DashboardData,
  community: CommunitySlug,
): number | null {
  return communityMembersEnteredFor(data.memberEntries, community, data.period)?.value ?? null;
}

/**
 * What this community's member total was at the last report.
 *
 * The previously-filed report is the baseline wherever one exists — that is
 * the whole point of keeping report records, and it means nobody re-types
 * last week's numbers. Before the first report exists there is nothing to
 * read, so this falls back to that community's own previous entry, which is
 * the same answer by a different route.
 */
export function previousCommunityMembers(
  data: DashboardData,
  community: CommunitySlug,
): number | null {
  const fromReport = data.previous?.snapshot.communities.find((c) => c.community === community);
  if (fromReport && fromReport.members !== null) return fromReport.members;
  const earlier = data.memberEntries.filter(
    (e) => e.scope === community && e.periodStart < data.period.start,
  );
  return earlier[earlier.length - 1]?.value ?? null;
}

/* ------------------------------------------------------------------- leads */

/** Leads one community added during this period, or null if none was entered for it. */
export function communityLeads(data: DashboardData, community: CommunitySlug): number | null {
  return communityLeadsFor(data.leadEntries, community, data.period)?.value ?? null;
}

/**
 * What that community reported at the last report.
 *
 * Only a filed report answers this. Leads are a flow, so there is no "reading
 * that was current before this period" to fall back on the way there is for a
 * member total — without a previous report there is simply nothing to compare
 * against, and the funnel shows no arrow.
 */
export function previousCommunityLeads(
  data: DashboardData,
  community: CommunitySlug,
): number | null {
  return (
    data.previous?.snapshot.communities.find((c) => c.community === community)?.leads ?? null
  );
}

/**
 * Leads across every community this period, and the comparable previous
 * total. Null — not zero — when nothing has been entered anywhere, so "we
 * haven't filled this in" stays distinguishable from "no leads came in".
 */
export function allCommunitiesLeads(data: DashboardData): {
  current: number | null;
  previous: number | null;
} {
  const currents = COMMUNITIES.map((c) => communityLeads(data, c.slug)).filter(
    (v): v is number => v !== null,
  );
  const previouses = COMMUNITIES.map((c) => previousCommunityLeads(data, c.slug)).filter(
    (v): v is number => v !== null,
  );
  return {
    current: currents.length > 0 ? currents.reduce((s, v) => s + v, 0) : null,
    previous: previouses.length > 0 ? previouses.reduce((s, v) => s + v, 0) : null,
  };
}

/* --------------------------------------------------------------- Instagram */

/** The broadcast channel's member count for this period — a level, so it carries forward. */
export function instagramMembers(data: DashboardData): number | null {
  return instagramMembersFor(data.instagramEntries, data.period)?.value ?? null;
}

/** The count entered for exactly this period — what the entry form pre-fills. */
export function instagramMembersEntered(data: DashboardData): number | null {
  return instagramMembersEnteredFor(data.instagramEntries, data.period)?.value ?? null;
}

/** Its count at the last report. */
export function previousInstagramMembers(data: DashboardData): number | null {
  if (data.previous && data.previous.snapshot.instagramMembers !== null) {
    return data.previous.snapshot.instagramMembers;
  }
  const earlier = data.instagramEntries.filter((e) => e.periodStart < data.period.start);
  return earlier[earlier.length - 1]?.value ?? null;
}

/* ---------------------------------------------------- imported-figure series */

/** One Short.io figure across the last filed reports, oldest first. */
export function shortioReportSeries(
  data: DashboardData,
  pick: (figures: ShortioFigures | null) => number | null,
  count = 12,
): { week: string; value: number | null }[] {
  return reportWindow(data, count).map((report) => ({
    week: report.periodEnd,
    value: pick(report.snapshot.shortio),
  }));
}

/**
 * The last `count` filed reports up to and including this period, oldest
 * first. The current period is included even before it has been filed, using
 * live figures, so the newest point on a chart is the one being looked at.
 */
export function reportWindow(data: DashboardData, count: number): FiledReport[] {
  const upTo = data.reports.filter((r) => r.periodEnd <= data.period.end);
  const withCurrent = data.current
    ? upTo
    : [
        ...upTo,
        {
          id: `${data.period.start}:${data.period.end}`,
          periodStart: data.period.start,
          periodEnd: data.period.end,
          filedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          snapshot: liveSnapshot(data),
        },
      ];
  return withCurrent.slice(Math.max(0, withCurrent.length - count));
}

/**
 * Landing-page traffic at the last report, for the up/down arrows.
 *
 * Only a filed report answers this. There is no honest fallback: an earlier
 * upload might cover any window at all, and differencing this period against
 * a fortnight-long export would produce an arrow that means nothing. No
 * previous report means no arrow.
 */
export function previousGa4(data: DashboardData): Ga4Figures | null {
  return data.previous?.snapshot.ga4 ?? null;
}

/** Community #2's link clicks at the last report. */
export function previousShortio(data: DashboardData): ShortioFigures | null {
  return data.previous?.snapshot.shortio ?? null;
}

/** The three GA4 headline figures, in display order. */
export const GA4_FIGURES: {
  key: string;
  label: string;
  hint: string;
  pick: (figures: Ga4Figures | null) => number | null;
}[] = [
  {
    key: 'activeUsers',
    label: 'Active users',
    hint: 'GA4 · landing page',
    pick: (g) => g?.activeUsers ?? null,
  },
  {
    key: 'newUsers',
    label: 'New users',
    hint: 'GA4 · landing page',
    pick: (g) => g?.newUsers ?? null,
  },
  {
    key: 'sessions',
    label: 'Sessions',
    hint: 'GA4 · landing page · source/medium',
    pick: (g) => g?.sessions ?? null,
  },
];

/* ------------------------------------------------------------- takeaways -- */

export interface Takeaway {
  tag: string;
  text: string;
  /**
   * `urgent` is for something a person should look at now — a group whose
   * conversation has turned sharply negative. The weekly report uses a third,
   * red callout for exactly this (a spam wave, a public argument), and with
   * only good/neutral there was no way to say it.
   */
  tone: 'good' | 'neutral' | 'urgent';
}

/**
 * Local, non-LLM "Headline Takeaways" for the Overview page: an activity
 * turnaround (Low → High vs. the previous filed period), the busiest
 * community, and any newly-small community worth flagging. Deliberately not
 * a Groq call — this runs on every page load, and a live LLM call per visit
 * would burn through the free tier's daily cap fast. A richer, Groq-written
 * version is available on demand via the "Regenerate" action — see
 * lib/ai/groq.ts and app/api/ai/overview-takeaways/route.ts.
 */
export function headlineTakeaways(data: DashboardData): Takeaway[] {
  const takeaways: Takeaway[] = [];

  for (const community of COMMUNITIES) {
    for (const group of groupsOf(community.slug)) {
      const current = data.perGroup.find((m) => m.group === group.slug);
      if (current?.activityLevel !== 'High') continue;
      const previous = data.previous?.snapshot.groups.find((g) => g.group === group.slug);
      if (previous?.activityLevel === 'Low') {
        takeaways.push({
          tag: 'Turnaround',
          text: `${group.label} (${community.label}) swung from Low to High activity this period.`,
          tone: 'good',
        });
      }
    }
  }

  /*
   * A group whose conversation has turned sharply negative, flagged for a
   * moderator look. Thresholded on both share and volume: 40% negative out of
   * five messages is two grumbles, not a problem, and flagging it would train
   * people to ignore the flag.
   */
  for (const community of COMMUNITIES) {
    for (const metrics of groupsInCommunity(data, community.slug)) {
      const negative = metrics.sentiment.negativePct;
      if (negative === null || (metrics.messageCount ?? 0) < 20) continue;
      if (negative < 25) continue;
      takeaways.push({
        tag: 'Worth a look',
        text:
          `${getGroup(metrics.group)?.label ?? metrics.group} (${community.label}) ran ` +
          `${negative.toFixed(0)}% negative across ${metrics.messageCount} messages this period — ` +
          `worth a moderator read.`,
        tone: 'urgent',
      });
    }
  }

  const byCommunity = perCommunityTotals(data).filter((c) => c.totals.groupsWithEntry > 0);
  const busiest = [...byCommunity].sort((a, b) => b.totals.messageCount - a.totals.messageCount)[0];
  if (busiest) {
    const config = COMMUNITIES.find((c) => c.slug === busiest.community);
    takeaways.push({
      tag: 'Most active',
      text:
        `${config?.label ?? busiest.community} led every community this period with ` +
        `${busiest.totals.messageCount.toLocaleString('en-US')} messages.`,
      tone: 'neutral',
    });
  }

  const leads = allCommunitiesLeads(data);
  if (leads.current !== null && leads.previous !== null && leads.previous > 0) {
    const change = leads.current - leads.previous;
    if (Math.abs(change) >= Math.max(3, leads.previous * 0.2)) {
      takeaways.push({
        tag: change > 0 ? 'Leads up' : 'Leads down',
        text:
          `${leads.current.toLocaleString('en-US')} leads added this period, ` +
          `${change > 0 ? 'up' : 'down'} from ${leads.previous.toLocaleString('en-US')}.`,
        tone: change > 0 ? 'good' : 'neutral',
      });
    }
  }

  // Communities that shrank this period — the reference report's amber
  // "still declining" callout. Pooled into one line rather than one per
  // community, which would crowd out everything else.
  const shrinking = COMMUNITIES.map((c) => ({
    community: c,
    current: communityMembers(data, c.slug)?.value ?? null,
    previous: previousCommunityMembers(data, c.slug),
  })).filter(
    (c): c is { community: (typeof COMMUNITIES)[number]; current: number; previous: number } =>
      c.current !== null && c.previous !== null && c.current < c.previous,
  );
  if (shrinking.length > 0) {
    takeaways.push({
      tag: shrinking.length === 1 ? 'Declining' : 'Still declining',
      text:
        `${shrinking
          .map((c) => `${c.community.label} (${c.current - c.previous})`)
          .join(', ')} lost members this period.`,
      tone: 'neutral',
    });
  }

  const communitiesWithMembers = COMMUNITIES.map((c) => ({
    community: c,
    total: communityMembers(data, c.slug)?.value ?? null,
  })).filter((c): c is { community: (typeof COMMUNITIES)[number]; total: number } => c.total !== null);
  const smallest = [...communitiesWithMembers].sort((a, b) => a.total - b.total)[0];
  if (smallest && communitiesWithMembers.length > 1 && smallest.total < 1000) {
    takeaways.push({
      tag: 'New & small',
      text:
        `${smallest.community.label} is still building, at ` +
        `${smallest.total.toLocaleString('en-US')} members.`,
      tone: 'neutral',
    });
  }

  return takeaways.slice(0, 4);
}

/* -------------------------------------------------------- filing a report -- */

/** Everything this period currently says, in the shape a filed report stores. */
export function liveSnapshot(data: DashboardData): ReportSnapshot {
  const communities: CommunityReportLine[] = COMMUNITIES.map((c) => {
    const totals = communityTotals(data, c.slug);
    return {
      community: c.slug,
      members: communityMembers(data, c.slug)?.value ?? null,
      leads: communityLeads(data, c.slug),
      messageCount: totals.messageCount,
      uniqueActiveChatters: totals.uniqueActiveChatters,
      groupsWithEntry: totals.groupsWithEntry,
      groupCount: totals.groupCount,
    };
  });

  const groups: GroupReportLine[] = data.perGroup.map((m) => ({
    group: m.group,
    community: m.community,
    messageCount: m.messageCount,
    uniqueActiveChatters: m.uniqueActiveChatters,
    activityLevel: m.activityLevel,
    mainTopics: m.mainTopics,
  }));

  const memberTotals = communities.map((c) => c.members).filter((v): v is number => v !== null);
  const leadTotals = communities.map((c) => c.leads).filter((v): v is number => v !== null);

  return {
    communities,
    groups,
    totalMembers: memberTotals.length > 0 ? memberTotals.reduce((s, v) => s + v, 0) : null,
    totalLeads: leadTotals.length > 0 ? leadTotals.reduce((s, v) => s + v, 0) : null,
    instagramMembers: instagramMembers(data),
    ga4: data.ga4.figures,
    shortio: data.shortio.figures,
  };
}

/**
 * Write this period's numbers into its filed report.
 *
 * Called from every write path — an upload, a member count, a leads figure, an
 * Instagram reading — rather than on page load, so a report's stored numbers
 * always match its own inputs but reading the dashboard never writes to it.
 */
export async function refreshReport(period: ReportPeriod): Promise<void> {
  const data = await loadDashboard(`${period.start}:${period.end}`);
  await upsertReport(period, liveSnapshot(data));
}

/**
 * Refresh every filed report, for something that invalidates all of them at
 * once — wiping the import store, say. Returns how many were rewritten.
 */
export async function refreshAllReports(): Promise<number> {
  const reports = await getReports();
  // Sequential for the same reason as `refreshReportsFor` below: each refresh
  // read-modify-writes the same reports document.
  for (const report of reports) {
    await refreshReport({ start: report.periodStart, end: report.periodEnd });
  }
  return reports.length;
}

/**
 * Refresh the filed reports a hand-entered figure could have changed: the
 * period it was filed for, and the active one if that differs (correcting a
 * past report shouldn't leave the current one stale, since a member total
 * carries forward into it).
 *
 * Sequential on purpose: each `refreshReport` does its own read-modify-write
 * of the same reports document, so running them concurrently would let one
 * overwrite the other's record.
 */
export async function refreshReportsFor(period: ReportPeriod): Promise<void> {
  const active = await getActivePeriod();
  const periods = samePeriod(period, active) ? [period] : [period, active];
  for (const p of periods) await refreshReport(p);
}
