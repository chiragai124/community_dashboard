import type { GroupSlug, ImportedFile } from '../types';
import type { ReportPeriod } from '../reports';
import { groupPeriods } from './store';

/**
 * Which WhatsApp upload answers for one group in one report period.
 *
 * An exact range match is the normal case — a community's exports are filed
 * as one batch under one range, so all five groups line up. An overlapping
 * range is accepted next, for a group filed on slightly different dates
 * before the batch upload existed.
 *
 * What is deliberately *not* accepted is an older, non-overlapping period.
 * Falling back to "this group's most recent report, whenever it was" would
 * quietly print August's conversation under a September heading, and it would
 * look exactly like fresh data. A group with nothing filed for the period
 * reports nothing for the period, which is the truth and is visible as such.
 */
export function groupPeriodFor(
  files: ImportedFile[],
  group: GroupSlug,
  period: ReportPeriod,
): ImportedFile | null {
  const periods = groupPeriods(files, group);

  const exact = periods.find(
    (f) => f.periodStart === period.start && f.periodEnd === period.end,
  );
  if (exact) return exact;

  const overlapping = periods.filter(
    (f) => f.periodStart! <= period.end && f.periodEnd! >= period.start,
  );
  return overlapping[overlapping.length - 1] ?? null;
}
