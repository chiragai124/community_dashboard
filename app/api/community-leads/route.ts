import { NextResponse } from 'next/server';
import { saveCommunityLeadEntry } from '@/lib/community-leads';
import { isCommunitySlug } from '@/lib/groups';
import { refreshReportsFor } from '@/lib/dashboard';
import { periodFromBody } from '@/lib/api-period';

/**
 * POST { community, leads, periodStart, periodEnd } — record how many leads
 * one community added to the CRM during one report period. Saving the same
 * community + period again replaces that entry rather than adding to it.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    community?: string;
    leads?: number | string;
    periodStart?: string;
    periodEnd?: string;
  };

  if (!isCommunitySlug(body.community)) {
    return NextResponse.json({ error: 'Unknown community.' }, { status: 400 });
  }

  const period = await periodFromBody(body);
  if ('error' in period) return NextResponse.json({ error: period.error }, { status: 400 });

  const leads = Number(body.leads);
  if (!Number.isFinite(leads) || leads < 0) {
    return NextResponse.json(
      { error: 'Enter a valid, non-negative number of leads.' },
      { status: 400 },
    );
  }

  const entry = await saveCommunityLeadEntry(body.community, leads, period);
  await refreshReportsFor(period);
  return NextResponse.json({ entry });
}
