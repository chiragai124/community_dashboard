import { NextResponse } from 'next/server';
import { saveInstagramChannel, saveInstagramMemberEntry } from '@/lib/instagram';
import { isValidISODate } from '@/lib/period';
import { refreshReportsFor } from '@/lib/dashboard';
import { periodFromBody } from '@/lib/api-period';

/**
 * POST { members?, periodStart?, periodEnd?, createdOn? } — the Instagram
 * broadcast channel's two manual inputs.
 *
 * `members` is a reading taken each report, filed against the report period
 * (see lib/api-period.ts for why the range is explicit); `createdOn` is the
 * standing creation date, set once and only re-sent to correct it. Either may
 * be sent alone: the form shows the creation date only until it has been set,
 * so most requests carry just a member count.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    members?: number | string;
    periodStart?: string;
    periodEnd?: string;
    createdOn?: string;
  };

  const wantsMembers = body.members !== undefined && body.members !== '';
  const wantsCreated = body.createdOn !== undefined && body.createdOn !== '';

  if (!wantsMembers && !wantsCreated) {
    return NextResponse.json(
      { error: 'Send a member count, a creation date, or both.' },
      { status: 400 },
    );
  }

  let createdOn: string | null = null;
  if (wantsCreated) {
    if (!isValidISODate(String(body.createdOn))) {
      return NextResponse.json(
        { error: 'Enter a valid creation date (YYYY-MM-DD).' },
        { status: 400 },
      );
    }
    createdOn = String(body.createdOn);
  }

  const period = await periodFromBody(body);
  if ('error' in period) return NextResponse.json({ error: period.error }, { status: 400 });

  let entry = null;
  if (wantsMembers) {
    const members = Number(body.members);
    if (!Number.isFinite(members) || members < 0) {
      return NextResponse.json(
        { error: 'Enter a valid, non-negative member count.' },
        { status: 400 },
      );
    }
    entry = await saveInstagramMemberEntry(members, period);
  }

  // Both inputs are validated above before either is written, so a request
  // carrying both can't leave one saved and the other rejected.
  const channel = createdOn ? await saveInstagramChannel(createdOn) : null;

  if (entry) await refreshReportsFor(period);

  return NextResponse.json({ entry, channel });
}
