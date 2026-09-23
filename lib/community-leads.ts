import type { CommunitySlug } from './types';
import { isCommunitySlug } from './groups';
import { createEntryLog, entryAsOf, entryBefore, type LogEntry } from './entry-log';

/**
 * "Leads added to the CRM this period", one append-only history per
 * community — see lib/entry-log.ts for why the history matters.
 *
 * This is a manual number on purpose. None of the three imports knows about
 * the CRM: a WhatsApp export contains conversations, not outcomes, and
 * there's no reliable way to tell from chat text alone whether a person was
 * actually added as a lead. Counting "people who asked about accommodation"
 * would be a guess wearing a number's clothes, so the real figure is typed in
 * instead.
 *
 * Unlike member totals, this is a *flow*, not a level: each entry is how many
 * leads were added during that report's period, not a running total. So the
 * Overview's funnel sums entries across communities for one period and
 * compares that against the previous report's sum — it never diffs two
 * readings the way member growth does.
 */

export type CommunityLeadEntry = LogEntry<CommunitySlug>;

const log = createEntryLog<CommunitySlug>({
  fileName: 'community-leads.json',
  isScope: isCommunitySlug,
});

/** Every entry, every community, oldest first. */
export const getCommunityLeadEntries = log.getEntries;

/** Record how many leads one community added, as of `enteredAt`. */
export function saveCommunityLeadEntry(
  community: CommunitySlug,
  leads: number,
  enteredAt: string,
): Promise<CommunityLeadEntry> {
  return log.saveEntry(community, leads, enteredAt);
}

/**
 * Leads recorded for the report period ending at `periodEnd` — the latest
 * entry dated on or before it. A report for a past period keeps reporting
 * the figure that was current then, not whatever has been entered since.
 */
export function communityLeadsAsOf(
  entries: CommunityLeadEntry[],
  community: CommunitySlug,
  periodEnd: string,
): CommunityLeadEntry | null {
  return entryAsOf(entries, community, periodEnd);
}

/** The reading current before `periodStart` — the previous report's figure. */
export function communityLeadsBefore(
  entries: CommunityLeadEntry[],
  community: CommunitySlug,
  periodStart: string,
): CommunityLeadEntry | null {
  return entryBefore(entries, community, periodStart);
}
