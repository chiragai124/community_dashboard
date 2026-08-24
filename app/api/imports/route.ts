import { NextResponse } from 'next/server';
import {
  ImportError,
  SOURCE_META,
  deleteImport,
  extractChatTextFromZip,
  extractGa4,
  extractShortio,
  extractWhatsapp,
  getImports,
  isImportSource,
  previousGroupPeriod,
  saveImport,
} from '@/lib/imports';
import { isCommunitySlug, communityHasImport, getCommunity, getGroup, isGroupSlug } from '@/lib/groups';
import { parseISODate, weekStartOf } from '@/lib/weeks';
import { isValidISODate } from '@/lib/period';
import { generateGroupSummary, groqEnabled } from '@/lib/ai/groq';

/**
 * Upload and removal of exports.
 *
 * POST multipart/form-data with `file`, `source`, and:
 *   - Short.io/GA4: `community` (Short.io only) + `weekStart`.
 *   - WhatsApp: `group` + `periodStart` + `periodEnd` — a manually-entered
 *     inclusive date range, not a week picker. The uploaded export should
 *     still be the group's FULL chat history (needed to replay member
 *     totals accurately through periodEnd); only messages inside
 *     [periodStart, periodEnd] count toward this report's message-level
 *     figures. Re-filing the same range replaces it.
 *
 * The file is parsed in-process and only the extracted figures are stored —
 * the upload itself is never written to disk, so the store stays small and
 * no chat transcript lingers on the server.
 *
 * DELETE ?id=… removes one stored report.
 */

// Needs the Node runtime: parsing an .xlsx uses zlib.
export const runtime = 'nodejs';
// A large chat export plus the Groq call this route makes can run past
// Vercel's default (10s on Hobby) function timeout, which fails silently
// from the client's point of view — the upload looks like nothing happened
// rather than a clear error, and needs a retry. 60s covers a busy group's
// export comfortably; raise further if a real upload still times out.
export const maxDuration = 60;

/** Generous for these exports, small enough that a mis-picked file is refused. */
const MAX_BYTES = 15 * 1024 * 1024;
/** WhatsApp exports are the group's full history and only grow — a larger cap. */
const MAX_WHATSAPP_BYTES = 25 * 1024 * 1024;
/**
 * "Include media" exports carry every photo/video/voice note in the chat's
 * full history on top of the text, so the archive is much bigger than a
 * text-only export — 80MB comfortably covers a full-history export for a
 * busy group. The whole upload is read into memory in one go (`arrayBuffer()`
 * below), so this stays well short of typical serverless memory/time limits
 * rather than trying to accept an unbounded archive.
 */
const MAX_WHATSAPP_ZIP_BYTES = 80 * 1024 * 1024;

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
  const file = form.get('file');

  if (!isImportSource(source)) {
    return NextResponse.json(
      { error: 'Unknown source. Expected "shortio", "ga4" or "whatsapp".' },
      { status: 400 },
    );
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'No file was attached.' }, { status: 400 });
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

  if (source === 'whatsapp') {
    const group = form.get('group');
    if (!isGroupSlug(group)) {
      return NextResponse.json({ error: 'Unknown group.' }, { status: 400 });
    }
    const periodStart = String(form.get('periodStart') ?? '');
    const periodEnd = String(form.get('periodEnd') ?? '');
    if (!isValidISODate(periodStart) || !isValidISODate(periodEnd)) {
      return NextResponse.json(
        { error: 'Enter a valid start and end date (YYYY-MM-DD) for this report.' },
        { status: 400 },
      );
    }
    if (periodEnd < periodStart) {
      return NextResponse.json({ error: 'The end date is before the start date.' }, { status: 400 });
    }

    const isZip = file.name.toLowerCase().endsWith('.zip');
    const sizeLimit = isZip ? MAX_WHATSAPP_ZIP_BYTES : MAX_WHATSAPP_BYTES;
    if (file.size > sizeLimit) {
      return NextResponse.json(
        {
          error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${sizeLimit / 1024 / 1024} MB${isZip ? ' for a "with media" export' : ''}.`,
        },
        { status: 413 },
      );
    }

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      // "Include media" exports are a .zip — the chat .txt is pulled out of
      // it and everything else (photos, videos, voice notes) is discarded
      // without ever being decompressed. "Without media" exports are already
      // plain text.
      const { text: chatText, filename: chatFilename } = isZip
        ? extractChatTextFromZip(buffer, file.name)
        : { text: buffer.toString('utf8'), filename: file.name };

      // Activity level is measured against this group's own previous filed
      // period (not this file's other weeks — there aren't any anymore).
      const existingImports = await getImports();
      const previous = previousGroupPeriod(existingImports, group, periodStart);

      const { figures, notes, warnings, periodMessages } = extractWhatsapp(
        chatText,
        chatFilename,
        { start: periodStart, end: periodEnd },
        previous?.whatsapp?.messageCount ?? null,
      );

      const allWarnings = [...warnings];
      // Warnings are persisted alongside notes (prefixed so they still read
      // as warnings later, not just more informational text) — so a user
      // checking back on a stored period without re-uploading still sees why
      // its figures might be off, not just the plain summary.
      const storedNotes = [...notes, ...allWarnings.map((w) => `⚠ ${w}`)];

      const groupConfig = getGroup(group)!;
      let aiGenerated = false;
      let aiSummary;
      if (groqEnabled() && periodMessages.length > 0) {
        const communityConfig = getCommunity(groupConfig.community);
        const summary = await generateGroupSummary({
          groupLabel: groupConfig.label,
          communityLabel: communityConfig?.label ?? groupConfig.community,
          messages: periodMessages,
          topVoices: figures.topVoices,
          messageCount: figures.messageCount,
          uniqueActiveChatters: figures.uniqueActiveChatters,
          activityLevel: figures.activityLevel,
          mainTopics: figures.mainTopics,
        });
        if (summary) {
          aiSummary = { ...summary, generatedAt: new Date().toISOString() };
          aiGenerated = true;
        }
      }

      const stored = await saveImport({
        source: 'whatsapp',
        community: groupConfig.community,
        group,
        periodStart,
        periodEnd,
        filename: file.name,
        notes: storedNotes,
        whatsapp: figures,
        aiSummary,
      });

      return NextResponse.json({
        periodStart: stored.periodStart,
        periodEnd: stored.periodEnd,
        notes,
        warnings: allWarnings,
        aiGenerated,
      });
    } catch (err) {
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

  const weekRaw = String(form.get('weekStart') ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekRaw)) {
    return NextResponse.json(
      { error: 'weekStart must be a YYYY-MM-DD date.' },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 15 MB.` },
      { status: 413 },
    );
  }
  // Always snap to the Monday, so a mid-week date can't create a second row.
  const weekStart = weekStartOf(parseISODate(weekRaw));

  // GA4 is landing-page traffic, not community data — no community to
  // validate, unlike Short.io below.
  if (source === 'ga4') {
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
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
        weekStart,
        filename: file.name,
        notes: allNotes,
        ga4: figures,
      });
      return NextResponse.json({ import: stored });
    } catch (err) {
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

  // Short.io is Community #2's own link data specifically — a community is
  // required, and communityHasImport enforces it's Community #2 (the only
  // community that declares this capability in lib/groups.ts).
  const community = form.get('community');
  if (!isCommunitySlug(community)) {
    return NextResponse.json({ error: 'Unknown community.' }, { status: 400 });
  }
  if (!communityHasImport(community, source)) {
    return NextResponse.json(
      { error: `${SOURCE_META[source].label} is not enabled for this community.` },
      { status: 400 },
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
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
