import type { CommunitySlug } from './types';
import { isCommunitySlug } from './groups';
import { createEntryLog, historyOf, type LogEntry } from './entry-log';

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
 * Leads recorded *inside* a report period, or null when none was entered for
 * it.
 *
 * Deliberately not "the latest entry on or before the period end", which is
 * how member totals resolve. A member total is a level: last month's reading
 * is still the best answer until a new one arrives. Leads are a flow — a
 * count of what came in during a window — so carrying an entry forward would
 * report the same 64 leads again in every subsequent report until someone
 * typed a new number, inflating the funnel indefinitely.
 *
 * Null means "not entered for this period", and the funnel says so rather
 * than showing a figure that belongs to an earlier one.
 */
export function communityLeadsIn(
  entries: CommunityLeadEntry[],
  community: CommunitySlug,
  period: { start: string; end: string },
): CommunityLeadEntry | null {
  const inside = historyOf(entries, community).filter(
    (e) => e.enteredAt >= period.start && e.enteredAt <= period.end,
  );
  // Latest wins if the period somehow holds two — the most recent correction.
  return inside[inside.length - 1] ?? null;
}
