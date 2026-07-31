import { NextResponse } from 'next/server';
import { getEntries, getEntriesForGroup, saveEntry } from '@/lib/store';
import { isGroupSlug } from '@/lib/groups';
import type { Poll, WeeklyEntryInput } from '@/lib/types';

/**
 * GET  /api/entries?group=uk   → stored weekly entries (all, or one group's)
 * POST /api/entries            → create or update one group-week
 *
 * `group` + `weekStart` is the natural key, so re-posting the same week edits it
 * rather than appending a duplicate.
 */

export async function GET(request: Request) {
  const group = new URL(request.url).searchParams.get('group');
  try {
    if (group) {
      if (!isGroupSlug(group)) {
        return NextResponse.json({ error: `Unknown group: ${group}` }, { status: 400 });
      }
      return NextResponse.json({ entries: await getEntriesForGroup(group) });
    }
    return NextResponse.json({ entries: await getEntries() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to read entries.' },
      { status: 500 },
    );
  }
}

function parsePolls(value: unknown): Poll[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      const poll = raw as { question?: unknown; options?: unknown };
      const options = Array.isArray(poll.options)
        ? poll.options
            .map((o) => {
              const option = o as { label?: unknown; count?: unknown };
              const count = Number(option.count ?? 0);
              return {
                label: String(option.label ?? '').trim(),
                count: Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0,
              };
            })
            .filter((o) => o.label !== '')
        : [];
      return { question: String(poll.question ?? '').trim(), options };
    })
    .filter((poll) => poll.question !== '');
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const group = body.group;
  if (!isGroupSlug(group)) {
    return NextResponse.json({ error: 'A valid `group` is required.' }, { status: 400 });
  }

  const weekStart = String(body.weekStart ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return NextResponse.json({ error: '`weekStart` is required as YYYY-MM-DD.' }, { status: 400 });
  }

  const dmsSent = Math.max(0, Math.round(Number(body.dmsSent) || 0));
  const dmReplies = Math.max(0, Math.round(Number(body.dmReplies) || 0));
  if (dmReplies > dmsSent) {
    return NextResponse.json({ error: 'DM replies cannot exceed DMs sent.' }, { status: 400 });
  }

  const input: WeeklyEntryInput = {
    group,
    weekStart,
    polls: parsePolls(body.polls),
    dmsSent,
    dmReplies,
  };

  try {
    const entry = await saveEntry(input);
    return NextResponse.json({ entry }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save entry.' },
      { status: 500 },
    );
  }
}
