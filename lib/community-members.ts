import type { CommunitySlug } from './types';
import type { ReportPeriod } from './reports';
import { isCommunitySlug } from './groups';
import {
  createEntryLog,
  entryForPeriod,
  historyOf,
  levelForPeriod,
  type LogEntry,
} from './entry-log';

/**
 * Manual "Total Members" entries, one append-only history per community,
 * each filed against a report period — see lib/entry-log.ts.
 *
 * WhatsApp exports don't reliably contain a group's full join/leave history
 * (older events can be missing depending on export settings and app version),
 * so a replay-based member total silently undercounts — see the module doc in
 * lib/imports/whatsapp.ts. Total membership is entered by hand instead.
 *
 * A member total is a **level**, not a flow: it is the size of the community
 * at a point in time, so last period's reading remains the best available
 * answer until a newer one is entered. That is why reads go through
 * `levelForPeriod` rather than demanding an exact match the way leads do.
 */

export type CommunityMemberEntry = LogEntry<CommunitySlug>;

const log = createEntryLog<CommunitySlug>({
  fileName: 'community-members.json',
  isScope: isCommunitySlug,
});

/** Every entry, every community, oldest period first. */
export const getCommunityMemberEntries = log.getEntries;

/** Record one community's total for a report period. */
export function saveCommunityMemberEntry(
  community: CommunitySlug,
  total: number,
  period: ReportPeriod,
): Promise<CommunityMemberEntry> {
  return log.saveEntry(community, total, period);
}

/** One community's history, oldest period first. */
export function communityMemberHistory(
  entries: CommunityMemberEntry[],
  community: CommunitySlug,
): CommunityMemberEntry[] {
  return historyOf(entries, community);
}

/** The total entered for exactly this period, or null — what the form pre-fills with. */
export function communityMembersEnteredFor(
  entries: CommunityMemberEntry[],
  community: CommunitySlug,
  period: ReportPeriod,
): CommunityMemberEntry | null {
  return entryForPeriod(entries, community, period);
}

/**
 * The total this period reports: its own entry, or the most recent earlier
 * one carried forward.
 */
export function communityMembersFor(
  entries: CommunityMemberEntry[],
  community: CommunitySlug,
  period: ReportPeriod,
): CommunityMemberEntry | null {
  return levelForPeriod(entries, community, period);
}
