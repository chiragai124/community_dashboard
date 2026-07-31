import type { GroupSlug } from '../types';
import type { WhatsAppWeek } from './analyse';

/**
 * Pure selectors over chat-derived records.
 *
 * Separate from ./store.ts ON PURPOSE. The store imports node:fs, and these
 * selectors are used by lib/metrics.ts, which client components import for its
 * formatters — so putting them together dragged node:fs into the browser bundle
 * and failed the build. Keeping the file I/O and the lookups in different modules
 * makes that impossible rather than merely avoided.
 */

/** The record shape both the store and the selectors agree on. */
export interface ChatRecordLike {
  group: GroupSlug;
  weeks: WhatsAppWeek[];
}

export function chatWeekFor<T extends ChatRecordLike>(
  records: T[],
  group: GroupSlug,
  weekStart: string,
): WhatsAppWeek | null {
  const record = records.find((r) => r.group === group);
  return record?.weeks.find((w) => w.weekStart === weekStart) ?? null;
}

export function chatRecordFor<T extends ChatRecordLike>(
  records: T[],
  group: GroupSlug,
): T | null {
  return records.find((r) => r.group === group) ?? null;
}
