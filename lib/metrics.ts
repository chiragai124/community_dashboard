import type { GroupPeriodMetrics, GroupSlug, ImportedFile } from './types';
import { emptySentiment } from './types';
import { getGroup } from './groups';

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

/* --------------------------------------------------------- the main assembler */

/**
 * Everything auto-computed for one group's latest filed report period, plus
 * the comparison against whatever period was filed immediately before it.
 * `latest`/`previous` are this group's own `ImportedFile` rows (WhatsApp
 * source only) — already picked out by the caller (see lib/dashboard.ts).
 */
export function buildGroupPeriodMetrics(
  group: GroupSlug,
  latest: ImportedFile | null,
  previous: ImportedFile | null,
): GroupPeriodMetrics {
  const whatsapp = latest?.whatsapp ?? null;
  const prevWhatsapp = previous?.whatsapp ?? null;

  const totalMembers = whatsapp?.totalMembers ?? null;
  const previousTotalMembers = prevWhatsapp?.totalMembers ?? null;

  return {
    group,
    community: getGroup(group)?.community ?? 'community-1',
    periodStart: latest?.periodStart ?? null,
    periodEnd: latest?.periodEnd ?? null,
    hasWhatsapp: whatsapp !== null,

    totalMembers,
    newMembers: whatsapp?.newMembers ?? null,
    memberGrowthPct:
      totalMembers !== null && previousTotalMembers !== null && previousTotalMembers > 0
        ? ((totalMembers - previousTotalMembers) / previousTotalMembers) * 100
        : null,
    previousTotalMembers,
    previousPeriodStart: previous?.periodStart ?? null,
    previousPeriodEnd: previous?.periodEnd ?? null,

    messageCount: whatsapp?.messageCount ?? null,
    uniqueActiveChatters: whatsapp?.uniqueActiveChatters ?? null,
    topVoices: whatsapp?.topVoices ?? [],

    activityLevel: whatsapp?.activityLevel ?? null,
    mainTopics: whatsapp?.mainTopics ?? [],
    topTopicMentions: whatsapp?.topTopicMentions ?? null,
    sentiment: whatsapp?.sentiment ?? emptySentiment(),

    aiSummary: latest?.aiSummary ?? null,
  };
}

/* ------------------------------------------------------------- formatting */

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
