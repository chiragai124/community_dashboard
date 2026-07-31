import { NextResponse } from 'next/server';
import {
  ImportError,
  SOURCE_META,
  deleteImport,
  extractGa4,
  extractShortio,
  isImportSource,
  saveImport,
} from '@/lib/imports';
import { isCommunitySlug, communityHasImport } from '@/lib/groups';
import { parseISODate, weekStartOf } from '@/lib/weeks';

/**
 * Upload and removal of the weekly exports.
 *
 * POST multipart/form-data with `file`, `source`, `community` and `weekStart`.
 * The file is parsed in-process and only the extracted figures are stored — the
 * upload itself is never written to disk, so the store stays small and no
 * spreadsheet of student data lingers on the server.
 *
 * DELETE ?id=… removes one week's figures.
 */

// Needs the Node runtime: parsing an .xlsx uses zlib.
export const runtime = 'nodejs';

/** Generous for these exports, small enough that a mis-picked file is refused. */
const MAX_BYTES = 15 * 1024 * 1024;

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
      { error: 'Unknown source. Expected "shortio" or "ga4".' },
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekRaw)) {
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
      { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 15 MB.` },
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

  // Always snap to the Monday, so a mid-week date can't create a second row.
  const weekStart = weekStartOf(parseISODate(weekRaw));

  try {
    const buffer = Buffer.from(await file.arrayBuffer());

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
  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id.' }, { status: 400 });
  }
  const removed = await deleteImport(id);
  if (!removed) {
    return NextResponse.json({ error: 'No import with that id.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
