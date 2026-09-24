import { NextResponse } from 'next/server';
import { saveCommunityMemberEntry } from '@/lib/community-members';
import { isCommunitySlug } from '@/lib/groups';
import { refreshReportsFor } from '@/lib/dashboard';
import { periodFromBody } from '@/lib/api-period';

/**
 * POST { community, total, periodStart, periodEnd } — record a manual "Total
 * Members" reading for one community, for one report period.
 *
 * The period is explicit rather than inferred from a single date the figure
 * happened to be typed on: consecutive reports share a boundary date on this
 * report's Wednesday-to-Wednesday cadence, and a date alone cannot say which
 * of the two a number belongs to. Saving the same community + period again
 * replaces that entry.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    community?: string;
    total?: number | string;
    periodStart?: string;
    periodEnd?: string;
  };

  if (!isCommunitySlug(body.community)) {
    return NextResponse.json({ error: 'Unknown community.' }, { status: 400 });
  }

  const period = await periodFromBody(body);
  if ('error' in period) return NextResponse.json({ error: period.error }, { status: 400 });

  const total = Number(body.total);
  if (!Number.isFinite(total) || total < 0) {
    return NextResponse.json({ error: 'Enter a valid, non-negative member total.' }, { status: 400 });
  }

  const entry = await saveCommunityMemberEntry(body.community, total, period);
  // Keep the filed report for this period — and the active one — in step, so
  // "vs. last report" never lags a save.
  await refreshReportsFor(period);
  return NextResponse.json({ entry });
}
