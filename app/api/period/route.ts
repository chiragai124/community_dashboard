import { NextResponse } from 'next/server';
import { isValidISODate } from '@/lib/period';
import { setActivePeriod } from '@/lib/reports';
import { refreshReport } from '@/lib/dashboard';

/**
 * POST { start, end } — change the date range every section of the dashboard
 * reports on.
 *
 * Uploading a batch of chat exports already sets this, so most weeks nobody
 * touches it. It exists for the cases uploading can't cover: reopening a past
 * period to correct a figure, or setting up a period before any export is
 * ready.
 *
 * Filing the report for the new period on the way in means the period picker
 * lists it immediately, rather than only once something has been uploaded
 * against it.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { start?: string; end?: string };

  const start = String(body.start ?? '');
  const end = String(body.end ?? '');
  if (!isValidISODate(start) || !isValidISODate(end)) {
    return NextResponse.json(
      { error: 'Enter a valid start and end date (YYYY-MM-DD).' },
      { status: 400 },
    );
  }
  if (end < start) {
    return NextResponse.json({ error: 'The end date is before the start date.' }, { status: 400 });
  }

  const period = await setActivePeriod({ start, end });
  await refreshReport(period);
  return NextResponse.json({ period });
}
