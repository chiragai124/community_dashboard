import { COMMUNITIES, groupsOf } from './groups';
import { ga4Week, getImports, latestGroupPeriod, previousGroupPeriod, shortioWeek } from './imports';
import { buildGroupPeriodMetrics } from './metrics';
import { currentWeekStart, lastNWeeks, parseISODate, weekStartOf } from './weeks';
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
 * One loader shared by every page: every imported file, assembled into the
 * current-period metrics for every WhatsApp group plus (for the Landing
 * page & WADL page only) the GA4/Short.io week being displayed.
 *
 * WhatsApp reports are keyed by a manually-entered date range per group, not
 * by a shared "displayed week" — each group simply shows its own most
 * recently filed period, independent of every other group. GA4/Short.io are
 * untouched and stay on the original Monday-anchored week system.
 */

export const TREND_WINDOW = 8;

export interface DashboardData {
  /** Every uploaded file, newest first. */
  imports: ImportedFile[];
  /** GA4/Short.io only: the week every "this week" figure on the Landing page & WADL refers to. */
  displayWeek: string;
  /** GA4/Short.io only: trailing window ending at displayWeek, oldest first. */
  weeks: string[];
  /** Each group's most recently filed WhatsApp report period. */
  perGroup: GroupPeriodMetrics[];
}

/**
 * `weekOverride` only affects the Landing page & WADL's GA4/Short.io figures
 * (via the `?week=` query param there) — WhatsApp-derived data ignores it
 * entirely, since each group's report period is set manually per upload,
 * not selected from a shared week picker.
 */
export async function loadDashboard(weekOverride?: string | null): Promise<DashboardData> {
  const thisWeek = currentWeekStart();
  const imports = await getImports();

  let displayWeek: string;
  if (weekOverride && /^\d{4}-\d{2}-\d{2}$/.test(weekOverride)) {
    displayWeek = weekStartOf(parseISODate(weekOverride));
  } else {
    const nonWhatsappWeeks = [
      ...new Set(
        imports.filter((f) => f.source !== 'whatsapp' && f.weekStart).map((f) => f.weekStart!),
      ),
    ];
    const hasCurrentWeek = nonWhatsappWeeks.includes(thisWeek);
    displayWeek = hasCurrentWeek
      ? thisWeek
      : nonWhatsappWeeks.reduce((latest, w) => (w > latest ? w : latest), thisWeek);
  }

  const perGroup = COMMUNITIES.flatMap((c) => c.groups).map((g) => {
    const latest = latestGroupPeriod(imports, g.slug);
    const previous = latest?.periodStart
      ? previousGroupPeriod(imports, g.slug, latest.periodStart)
      : null;
    return buildGroupPeriodMetrics(g.slug, latest, previous);
  });

  return {
    imports,
    displayWeek,
    weeks: lastNWeeks(TREND_WINDOW, displayWeek),
    perGroup,
  };
}

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

/** Every filed period for one group, oldest first — for the group page's membership trend. */
export function groupPeriodSeries(data: DashboardData, group: GroupSlug): GroupPeriodMetrics[] {
  const periods = data.imports
    .filter((f) => f.source === 'whatsapp' && f.group === group && f.periodStart)
    .sort((a, b) => (a.periodStart! < b.periodStart! ? -1 : 1));
  return periods.map((_, i) =>
    buildGroupPeriodMetrics(group, periods[i], periods[i - 1] ?? null),
  );
}

/** Weeks offered in the Short.io/GA4 upload panels: this week plus the previous 7, newest first. */
export function entryWeekOptions(count = TREND_WINDOW): string[] {
  return [...lastNWeeks(count, currentWeekStart())].reverse();
}

/* --------------------------------------------------------- roll-ups & series */

/** Pooled totals over any set of groups — every count simply sums. */
export function rollup(metrics: GroupPeriodMetrics[]): RollupTotals {
  return {
    members: metrics.reduce((s, m) => s + (m.totalMembers ?? 0), 0),
    newMembers: metrics.reduce((s, m) => s + (m.newMembers ?? 0), 0),
    messageCount: metrics.reduce((s, m) => s + (m.messageCount ?? 0), 0),
    // Sum of each group's own unique-chatter count — an upper bound, not a
    // true cross-group union (raw sender identities aren't kept once a
    // group's figures are computed and persisted).
    uniqueActiveChatters: metrics.reduce((s, m) => s + (m.uniqueActiveChatters ?? 0), 0),
    previousMembers: metrics.reduce((s, m) => s + (m.previousTotalMembers ?? 0), 0),
    groupsWithEntry: metrics.filter((m) => m.hasWhatsapp).length,
    groupCount: metrics.length,
  };
}

/** Pooled totals for one community. */
export function communityTotals(data: DashboardData, community: CommunitySlug): RollupTotals {
  return rollup(groupsInCommunity(data, community));
}

/** Pooled totals across every community — the Overview page's headline figures. */
export function allCommunitiesTotals(data: DashboardData): RollupTotals {
  return rollup(data.perGroup);
}

/** Per-community roll-ups, in registry order. */
export function perCommunityTotals(
  data: DashboardData,
): { community: CommunitySlug; totals: RollupTotals }[] {
  return COMMUNITIES.map((c) => ({ community: c.slug, totals: communityTotals(data, c.slug) }));
}

/**
 * The widest date range covered by any group's latest filed period — the
 * closest thing to "the period" for the Overview page, which pools groups
 * that may each be on their own independently-filed range. Null when
 * nothing has been filed anywhere yet.
 */
export function overallPeriodRange(data: DashboardData): { start: string; end: string } | null {
  const withData = data.perGroup.filter((m) => m.periodStart && m.periodEnd);
  if (withData.length === 0) return null;
  const start = withData.reduce((min, m) => (m.periodStart! < min ? m.periodStart! : min), withData[0].periodStart!);
  const end = withData.reduce((max, m) => (m.periodEnd! > max ? m.periodEnd! : max), withData[0].periodEnd!);
  return { start, end };
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

export interface Takeaway {
  tag: string;
  text: string;
  tone: 'good' | 'neutral';
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
      if (current?.activityLevel === 'High') {
        const prevSeries = groupPeriodSeries(data, group.slug);
        const previous = prevSeries[prevSeries.length - 2];
        if (previous?.activityLevel === 'Low') {
          takeaways.push({
            tag: 'Turnaround',
            text: `${group.label} (${community.label}) swung from Low to High activity this period.`,
            tone: 'good',
          });
        }
      }
    }
  }

  const byCommunity = perCommunityTotals(data).filter((c) => c.totals.groupsWithEntry > 0);
  const busiest = [...byCommunity].sort((a, b) => b.totals.messageCount - a.totals.messageCount)[0];
  if (busiest) {
    const config = COMMUNITIES.find((c) => c.slug === busiest.community);
    takeaways.push({
      tag: 'Most active',
      text: `${config?.label ?? busiest.community} led every community this period with ` +
        `${busiest.totals.messageCount.toLocaleString('en-US')} messages.`,
      tone: 'neutral',
    });
  }

  const smallest = [...byCommunity].sort((a, b) => a.totals.members - b.totals.members)[0];
  if (smallest && byCommunity.length > 1 && smallest.totals.members < 1000) {
    const config = COMMUNITIES.find((c) => c.slug === smallest.community);
    takeaways.push({
      tag: 'New & small',
      text: `${config?.label ?? smallest.community} is still building, at ` +
        `${smallest.totals.members.toLocaleString('en-US')} members.`,
      tone: 'neutral',
    });
  }

  return takeaways.slice(0, 4);
}

/* ------------------------------------------------------- imported figures -- */

/**
 * Landing-page GA4 figures for the displayed week. Deliberately NOT
 * community-scoped or pooled across communities — GA4 describes the
 * website's traffic, not any WhatsApp community's, so there is exactly one
 * of these, ever, not one per community summed together.
 */
export function landingPageGa4(
  data: DashboardData,
  weekStart: string = data.displayWeek,
): Ga4Figures | null {
  return ga4Week(data.imports, weekStart);
}

/** One GA4 figure across the trend window, oldest week first. */
export function ga4Series(
  data: DashboardData,
  pick: (figures: Ga4Figures | null) => number | null,
  weeks: string[] = data.weeks,
): { week: string; value: number | null }[] {
  return weeks.map((week) => ({ week, value: pick(ga4Week(data.imports, week)) }));
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
    hint: 'GA4 · landing page · this week',
    pick: (g) => g?.activeUsers ?? null,
  },
  {
    key: 'newUsers',
    label: 'New users',
    hint: 'GA4 · landing page · this week',
    pick: (g) => g?.newUsers ?? null,
  },
  {
    key: 'sessions',
    label: 'Sessions',
    hint: 'GA4 · landing page · source/medium',
    pick: (g) => g?.sessions ?? null,
  },
];

/**
 * Community #2's Short.io figures for the displayed week — Short.io is
 * specifically Community #2's own link data, not a shared/generic source, so
 * this is never pooled with anything else.
 */
export function communityShortio(
  data: DashboardData,
  community: CommunitySlug,
  weekStart: string = data.displayWeek,
): ShortioFigures | null {
  return shortioWeek(data.imports, community, weekStart);
}

/** One Short.io figure across the trend window, oldest week first. */
export function shortioSeries(
  data: DashboardData,
  community: CommunitySlug,
  pick: (figures: ShortioFigures | null) => number | null,
  weeks: string[] = data.weeks,
): { week: string; value: number | null }[] {
  return weeks.map((week) => ({
    week,
    value: pick(shortioWeek(data.imports, community, week)),
  }));
}
