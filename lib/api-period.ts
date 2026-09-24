import { isValidISODate } from './period';
import { getActivePeriod, type ReportPeriod } from './reports';

/**
 * The report period a manual figure is being filed for.
 *
 * Every manual-entry endpoint takes the range explicitly, because a single
 * date cannot identify a period on this report's cadence: it runs Wednesday
 * to Wednesday, so 16 Sep both opens 16–23 Sep and closes 9–16 Sep. Omitting
 * the range falls back to whatever period the dashboard is currently on,
 * which is what the forms send anyway — the fallback exists so a hand-rolled
 * request isn't obliged to repeat it.
 */
export async function periodFromBody(body: {
  periodStart?: string;
  periodEnd?: string;
}): Promise<ReportPeriod | { error: string }> {
  const start = String(body.periodStart ?? '');
  const end = String(body.periodEnd ?? '');

  if (start === '' && end === '') return getActivePeriod();

  if (!isValidISODate(start) || !isValidISODate(end)) {
    return { error: 'Enter a valid report period (periodStart and periodEnd, YYYY-MM-DD).' };
  }
  if (end < start) return { error: 'The end date is before the start date.' };
  return { start, end };
}
