import { NextResponse } from 'next/server';
import {
  ImportError,
  SOURCE_META,
  analyseChatExport,
  deleteChatImport,
  deleteImport,
  extractGa4,
  extractShortio,
  isImportSource,
  saveChatImport,
  saveImport,
} from '@/lib/imports';
import { getGroup, isCommunitySlug, isGroupSlug, communityHasImport } from '@/lib/groups';
import { parseISODate, weekStartOf } from '@/lib/weeks';

/**
 * Upload and removal of the weekly exports.
 *
 * POST multipart/form-data with `file`, `source`, `community`, and then either
 * `weekStart` (Short.io, GA4) or `group` (WhatsApp — a transcript belongs to one
 * group and carries its own history, so it needs no week).
 *
 * EVERY upload is parsed in-process and discarded. Only derived figures are
 * stored, so no spreadsheet and no chat transcript ever lands on disk. For the
 * chat export that means counts, term frequencies, questions, sentiment
 * percentages and three example quotes per sentiment — never the transcript,
 * sender names or phone numbers.
 *
 * DELETE ?id=… removes one week's Short.io/GA4 figures; DELETE ?group=… removes a
 * group's whole chat-derived record.
 */

// Needs the Node runtime: parsing an .xlsx uses zlib.
export const runtime = 'nodejs';

/**
 * Generous for these exports, small enough that a mis-picked file is refused.
 * A media-free chat export of a busy year-old group is a few MB; a media-INCLUDED
 * one is hundreds, which is why the steps say "Without media".
 */
const MAX_BYTES = 60 * 1024 * 1024;

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Expected a multipart form upload.' },
      { status: 400 },
    );
  }

  const source = form.get('source');
  const community = form.get('community');
  const weekRaw = String(form.get('weekStart') ?? '');
  const file = form.get('file');

  if (!isImportSource(source)) {
    return NextResponse.json(
      { error: 'Unknown source. Expected "shortio", "ga4" or "whatsapp".' },
      { status: 400 },
    );
  }
  if (!isCommunitySlug(community)) {
    return NextResponse.json({ error: 'Unknown community.' }, { status: 400 });
  }
  if (!communityHasImport(community, source)) {
    return NextResponse.json(
      { error: `${SOURCE_META[source].label} is not enabled for this community.` },
      { status: 400 },
    );
  }
  // A chat export backfills every week it covers, so it needs no week — but it
  // does need a group, since a transcript belongs to exactly one group.
  if (source !== 'whatsapp' && !/^\d{4}-\d{2}-\d{2}$/.test(weekRaw)) {
    return NextResponse.json(
      { error: 'weekStart must be a YYYY-MM-DD date.' },
      { status: 400 },
    );
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'No file was attached.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error:
          `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ` +
          `${MAX_BYTES / 1024 / 1024} MB. For a chat export, re-export it "Without media".`,
      },
      { status: 413 },
    );
  }

  const meta = SOURCE_META[source];
  const name = file.name.toLowerCase();
  if (!meta.extensions.some((ext) => name.endsWith(ext))) {
    return NextResponse.json(
      {
        error:
          `${meta.label} expects ${meta.fileDescription}, but “${file.name}” is not ` +
          `${meta.extensions.join(' or ')}. Check you picked the right export.`,
      },
      { status: 400 },
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());

    if (source === 'whatsapp') {
      const group = form.get('group');
      if (!isGroupSlug(group)) {
        return NextResponse.json(
          { error: 'A chat export needs a `group` — a transcript belongs to one group.' },
          { status: 400 },
        );
      }
      if (getGroup(group)?.community !== community) {
        return NextResponse.json(
          { error: 'That group is not part of this community.' },
          { status: 400 },
        );
      }

      // Parsed in memory; the transcript is never written to disk. Only counts,
      // terms, questions, percentages and three example quotes per sentiment are
      // stored — see lib/whatsapp/store.ts.
      const analysis = analyseChatExport(buffer, file.name, group);
      const stored = await saveChatImport(analysis, file.name);
      return NextResponse.json({
        chatImport: {
          group: stored.group,
          filename: stored.filename,
          uploadedAt: stored.uploadedAt,
          membersKnown: stored.membersKnown,
          weeks: stored.weeks.length,
          notes: stored.notes,
        },
      });
    }

    // Always snap to the Monday, so a mid-week date can't create a second row.
    const weekStart = weekStartOf(parseISODate(weekRaw));

    if (source === 'shortio') {
      const { figures, notes } = extractShortio(buffer, file.name);
      const stored = await saveImport({
        source,
        community,
        weekStart,
        filename: file.name,
        notes,
        shortio: figures,
      });
      return NextResponse.json({ import: stored });
    }

    const { figures, notes, dateRange } = extractGa4(buffer.toString('utf8'), file.name);
    // A snapshot filed under the wrong week is the easy mistake to make, and the
    // numbers look perfectly plausible when it happens — so say so rather than
    // silently accepting it. The upload still goes through; it's the user's call.
    const allNotes = [...notes];
    if (dateRange && (dateRange.start < weekStart || dateRange.start > weekStart)) {
      allNotes.push(
        `Heads up: this export covers ${dateRange.start} to ${dateRange.end}, but it has ` +
          `been filed under the week starting ${weekStart}.`,
      );
    }

    const stored = await saveImport({
      source,
      community,
      weekStart,
      filename: file.name,
      notes: allNotes,
      ga4: figures,
    });
    return NextResponse.json({ import: stored });
  } catch (err) {
    // A bad file is the user's problem to fix, and the message says how; anything
    // else is ours, and shouldn't be dressed up as a validation failure.
    if (err instanceof ImportError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Could not read that file: ${err.message}`
            : 'Could not read that file.',
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;

  // A chat import is keyed by group, not by an id, since there is one per group.
  const group = params.get('group');
  if (group) {
    const removed = await deleteChatImport(group);
    if (!removed) {
      return NextResponse.json({ error: 'No chat import for that group.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  }

  const id = params.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id.' }, { status: 400 });
  }
  const removed = await deleteImport(id);
  if (!removed) {
    return NextResponse.json({ error: 'No import with that id.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
