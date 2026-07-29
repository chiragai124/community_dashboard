import { NextResponse } from 'next/server';
import { getEntries, getEntriesForGroup, saveEntry } from '@/lib/store';
import { isGroupSlug } from '@/lib/groups';
import type { ActivityLevel, Poll, WeeklyEntryInput } from '@/lib/types';

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

function parseActivity(value: unknown): ActivityLevel {
  return value === 'Low' || value === 'High' || value === 'Medium' ? value : 'Medium';
}

/**
 * A list of short strings. Accepts an array or a single comma/newline-separated
 * string, so the API is usable by hand as well as by the form. Items are trimmed,
 * blanks dropped, and each is capped so a pasted essay can't land in a tag list.
 */
function parseStringList(value: unknown, maxItemLength = 160, maxItems = 40): string[] {
  const items = Array.isArray(value)
    ? value.map((v) => String(v ?? ''))
    : typeof value === 'string'
      ? value.split(/[,\n]/)
      : [];
  return items
    .map((s) => s.trim().slice(0, maxItemLength))
    .filter((s) => s !== '')
    .slice(0, maxItems);
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
    return NextResponse.json(
      { error: 'A valid `group` is required (uk, usa, australia, canada, germany).' },
      { status: 400 },
    );
  }

  const weekStart = String(body.weekStart ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return NextResponse.json(
      { error: '`weekStart` is required as YYYY-MM-DD.' },
      { status: 400 },
    );
  }

  const totalMembers = Number(body.totalMembers);
  if (!Number.isFinite(totalMembers) || totalMembers < 0) {
    return NextResponse.json(
      { error: '`totalMembers` is required and must be zero or more.' },
      { status: 400 },
    );
  }

  const overrideRaw = body.newMembersOverride;
  const overrideNum = Number(overrideRaw);
  const newMembersOverride =
    overrideRaw === null || overrideRaw === undefined || overrideRaw === '' || !Number.isFinite(overrideNum)
      ? null
      : Math.round(overrideNum);

  const input: WeeklyEntryInput = {
    group,
    weekStart,
    totalMembers: Math.round(totalMembers),
    newMembersOverride,
    polls: parsePolls(body.polls),
    dmsSent: Math.max(0, Math.round(Number(body.dmsSent) || 0)),
    dmReplies: Math.max(0, Math.round(Number(body.dmReplies) || 0)),
    activityLevel: parseActivity(body.activityLevel),
    activityNote: String(body.activityNote ?? '').trim().slice(0, 500),
    mainTopics: parseStringList(body.mainTopics, 60),
    commonQuestions: parseStringList(body.commonQuestions, 200),
    contentResponse: String(body.contentResponse ?? '').trim().slice(0, 1000),
    notes: String(body.notes ?? ''),
  };

  if (input.dmReplies! > input.dmsSent!) {
    return NextResponse.json(
      { error: 'DM replies cannot exceed DMs sent.' },
      { status: 400 },
    );
  }

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
