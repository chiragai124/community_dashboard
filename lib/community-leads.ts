import type { CommunitySlug } from './types';
import type { ReportPeriod } from './reports';
import { isCommunitySlug } from './groups';
import { createEntryLog, entryForPeriod, historyOf, type LogEntry } from './entry-log';

/**
 * "Leads added to the CRM this period", one append-only history per
 * community, each filed against a report period — see lib/entry-log.ts.
 *
 * This is a manual number on purpose. None of the three imports knows about
 * the CRM: a WhatsApp export contains conversations, not outcomes, and there
 * is no reliable way to tell from chat text alone whether a person was
 * actually added as a lead. Counting "people who asked about accommodation"
 * would be a guess wearing a number's clothes.
 *
 * Leads are a **flow**, not a level: each figure is how many came in *during*
 * one period. So a period with no entry reports none — carrying an earlier
 * figure forward would report the same leads again in every later report and
 * inflate the funnel indefinitely. Reads are therefore an exact match on the
 * period, never a fallback to an earlier one.
 */

export type CommunityLeadEntry = LogEntry<CommunitySlug>;

const log = createEntryLog<CommunitySlug>({
  fileName: 'community-leads.json',
  isScope: isCommunitySlug,
});

/** Every entry, every community, oldest period first. */
export const getCommunityLeadEntries = log.getEntries;

/** Record how many leads one community added during a report period. */
export function saveCommunityLeadEntry(
  community: CommunitySlug,
  leads: number,
  period: ReportPeriod,
): Promise<CommunityLeadEntry> {
  return log.saveEntry(community, leads, period);
}

/** One community's history, oldest period first. */
export function communityLeadHistory(
  entries: CommunityLeadEntry[],
  community: CommunitySlug,
): CommunityLeadEntry[] {
  return historyOf(entries, community);
}

/** Leads entered for exactly this period, or null when none was. */
export function communityLeadsFor(
  entries: CommunityLeadEntry[],
  community: CommunitySlug,
  period: ReportPeriod,
): CommunityLeadEntry | null {
  return entryForPeriod(entries, community, period);
}
