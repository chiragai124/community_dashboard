import { NextResponse } from 'next/server';
import { saveCommunityMemberEntry } from '@/lib/community-members';
import { isCommunitySlug } from '@/lib/groups';
import { isValidISODate } from '@/lib/period';

/**
 * POST { community, total, enteredAt? } — record a manual "Total Members"
 * reading for one community. `enteredAt` defaults to today (YYYY-MM-DD).
 * Saving the same community + date again replaces that entry.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    community?: string;
    total?: number | string;
    enteredAt?: string;
  };

  if (!isCommunitySlug(body.community)) {
    return NextResponse.json({ error: 'Unknown community.' }, { status: 400 });
  }

  const total = Number(body.total);
  if (!Number.isFinite(total) || total < 0) {
    return NextResponse.json({ error: 'Enter a valid, non-negative member total.' }, { status: 400 });
  }

  const enteredAt = body.enteredAt || new Date().toISOString().slice(0, 10);
  if (!isValidISODate(enteredAt)) {
    return NextResponse.json({ error: 'Enter a valid date (YYYY-MM-DD).' }, { status: 400 });
  }

  const entry = await saveCommunityMemberEntry(body.community, total, enteredAt);
  return NextResponse.json({ entry });
}
