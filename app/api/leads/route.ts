import { NextResponse } from 'next/server';
import { deleteLead, getLeads, parseLeadBlock, saveLeads } from '@/lib/leads';
import { isGroupSlug } from '@/lib/groups';
import type { LeadInput } from '@/lib/types';
import { parseISODate, weekStartOf } from '@/lib/weeks';

/**
 * GET    /api/leads?group=uk   → stored leads (all, or one group's)
 * POST   /api/leads            → save one lead, or a pasted block of rows
 * DELETE /api/leads?id=…       → remove one lead
 *
 * PERSONAL DATA passes through here. GET is included because the store is a plain
 * file and reading it back is how you check what was saved — but note it returns
 * names, emails and phone numbers, so it is only as private as the host is.
 */

export const runtime = 'nodejs';

/** Refuse a paste big enough to suggest the wrong thing was pasted. */
const MAX_BLOCK_CHARS = 200_000;
const MAX_ROWS = 2_000;

export async function GET(request: Request) {
  const group = new URL(request.url).searchParams.get('group');
  try {
    const leads = await getLeads();
    if (group) {
      if (!isGroupSlug(group)) {
        return NextResponse.json({ error: `Unknown group: ${group}` }, { status: 400 });
      }
      return NextResponse.json({ leads: leads.filter((l) => l.group === group) });
    }
    return NextResponse.json({ leads });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to read leads.' },
      { status: 500 },
    );
  }
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

  const weekRaw = String(body.weekStart ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekRaw)) {
    return NextResponse.json(
      { error: '`weekStart` is required as YYYY-MM-DD.' },
      { status: 400 },
    );
  }
  const weekStart = weekStartOf(parseISODate(weekRaw));

  let rows: LeadInput[];
  let parseNote: string | null = null;

  if (typeof body.block === 'string' && body.block.trim() !== '') {
    if (body.block.length > MAX_BLOCK_CHARS) {
      return NextResponse.json(
        { error: 'That paste is too large. Split it into smaller batches.' },
        { status: 413 },
      );
    }
    const parsed = parseLeadBlock(body.block, group, weekStart);
    if (parsed.rows.length === 0) {
      return NextResponse.json(
        { error: 'No rows found in that paste. Expected one lead per line.' },
        { status: 422 },
      );
    }
    if (parsed.rows.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `That paste has ${parsed.rows.length} rows; the limit is ${MAX_ROWS}.` },
        { status: 413 },
      );
    }
    rows = parsed.rows;
    parseNote = parsed.usedHeader
      ? `Read the first row as column headers: ${parsed.columns.join(', ')}.`
      : `No header row found, so columns were read in order: ${parsed.columns.join(', ')}.`;
  } else {
    rows = [
      {
        group,
        weekStart,
        name: String(body.name ?? ''),
        email: String(body.email ?? ''),
        phone: String(body.phone ?? ''),
        university: String(body.university ?? ''),
        country: String(body.country ?? ''),
      },
    ];
  }

  try {
    const result = await saveLeads(rows);
    if (result.added === 0 && result.updated === 0) {
      return NextResponse.json(
        {
          error:
            'Nothing was saved — every row was empty. A lead needs at least one of ' +
            'name, email, phone, university or country.',
        },
        { status: 422 },
      );
    }
    return NextResponse.json({
      added: result.added,
      updated: result.updated,
      skipped: result.skipped,
      note: parseNote,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save leads.' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 });
  const removed = await deleteLead(id);
  if (!removed) {
    return NextResponse.json({ error: 'No lead with that id.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
