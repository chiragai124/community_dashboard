import { NextResponse } from 'next/server';
import { saveCommunityLeadEntry } from '@/lib/community-leads';
import { isCommunitySlug } from '@/lib/groups';
import { isValidISODate } from '@/lib/period';
import { refreshReportsFor } from '@/lib/dashboard';

/**
 * POST { community, leads, enteredAt? } — record how many leads one
 * community added to the CRM for the report period ending at `enteredAt`
 * (defaults to today). Saving the same community + date again replaces that
 * entry rather than adding to it.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    community?: string;
    leads?: number | string;
    enteredAt?: string;
  };

  if (!isCommunitySlug(body.community)) {
    return NextResponse.json({ error: 'Unknown community.' }, { status: 400 });
  }

  const leads = Number(body.leads);
  if (!Number.isFinite(leads) || leads < 0) {
    return NextResponse.json(
      { error: 'Enter a valid, non-negative number of leads.' },
      { status: 400 },
    );
  }

  const enteredAt = body.enteredAt || new Date().toISOString().slice(0, 10);
  if (!isValidISODate(enteredAt)) {
    return NextResponse.json({ error: 'Enter a valid date (YYYY-MM-DD).' }, { status: 400 });
  }

  const entry = await saveCommunityLeadEntry(body.community, leads, enteredAt);
  await refreshReportsFor(enteredAt);
  return NextResponse.json({ entry });
}
