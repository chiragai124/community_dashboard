import { NextResponse } from 'next/server';
import type { GroupConfig, GroupSlug, ImportedFile } from '@/lib/types';
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
  saveImports,
} from '@/lib/imports';
import { detectGroup, detectionCandidates, type GroupDetection } from '@/lib/imports/detect-group';
import {
  communityHasImport,
  getCommunity,
  getGroup,
  groupsOf,
  isCommunitySlug,
  isGroupSlug,
} from '@/lib/groups';
import { isValidISODate } from '@/lib/period';
import { setActivePeriod, type ReportPeriod } from '@/lib/reports';
import { refreshReport } from '@/lib/dashboard';
import { generateGroupSummary, groqEnabled } from '@/lib/ai/groq';

/**
 * Upload and removal of exports.
 *
 * POST multipart/form-data with `source`, a date range (`periodStart` +
 * `periodEnd`), and:
 *   - **WhatsApp**: `community` plus one or more `file` entries — a whole
 *     community's group exports dropped in together. Each file's group is
 *     worked out from the chat's own name (see lib/imports/detect-group.ts);
 *     an optional `group` pins a single file when detection couldn't.
 *   - **Short.io**: `community` and one `file`.
 *   - **GA4**: one `file` (landing-page traffic, not community-scoped).
 *
 * Every successful upload makes its range the active reporting period and
 * refreshes that period's filed report, so the rest of the dashboard follows
 * the dates entered here rather than keeping its own.
 *
 * Files are parsed in-process and only the extracted figures are stored — the
 * uploads themselves are never written to disk, so no chat transcript
 * lingers on the server.
 *
 * DELETE ?id=… removes one stored report.
 */

// Needs the Node runtime: parsing an .xlsx uses zlib.
export const runtime = 'nodejs';
/**
 * A batch of five full-history chat exports plus a Groq call each can run
 * well past Vercel's default (10s on Hobby) function timeout, which fails
 * silently from the client's point of view. 300s is the ceiling on Vercel's
 * paid plans; the AI budget below keeps a batch inside it regardless.
 */
export const maxDuration = 300;

/** Generous for these exports, small enough that a mis-picked file is refused. */
const MAX_BYTES = 15 * 1024 * 1024;
/** WhatsApp exports are the group's full history and only grow — a larger cap. */
const MAX_WHATSAPP_BYTES = 25 * 1024 * 1024;
/**
 * "Include media" exports carry every photo/video/voice note in the chat's
 * full history on top of the text, so the archive is much bigger than a
 * text-only export.
 */
const MAX_WHATSAPP_ZIP_BYTES = 80 * 1024 * 1024;
/** One community is five groups; a little headroom over that. */
const MAX_BATCH_FILES = 12;
/**
 * How long a batch may spend on AI summaries before it stops asking for them.
 *
 * The figures are what the upload is for; the narrative is a bonus. Running
 * out of time part-way through a batch must not lose the four exports that
 * already parsed, so once the budget is gone the rest are saved without a
 * summary and the response says how many got one.
 */
const AI_BUDGET_MS = 120_000;

function periodFromForm(form: FormData): ReportPeriod | { error: string } {
  const start = String(form.get('periodStart') ?? '');
  const end = String(form.get('periodEnd') ?? '');
  if (!isValidISODate(start) || !isValidISODate(end)) {
    return { error: 'Enter a valid start and end date (YYYY-MM-DD) for this report.' };
  }
  if (end < start) return { error: 'The end date is before the start date.' };
  return { start, end };
}

function failure(err: unknown): NextResponse {
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

/** Make this the period every section reports on, and refresh its record. */
async function adoptPeriod(period: ReportPeriod): Promise<void> {
  await setActivePeriod(period);
  await refreshReport(period);
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a multipart form upload.' }, { status: 400 });
  }

  const source = form.get('source');
  if (!isImportSource(source)) {
    return NextResponse.json(
      { error: 'Unknown source. Expected "shortio", "ga4" or "whatsapp".' },
      { status: 400 },
    );
  }

  const period = periodFromForm(form);
  if ('error' in period) return NextResponse.json({ error: period.error }, { status: 400 });

  const files = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return NextResponse.json({ error: 'No file was attached.' }, { status: 400 });
  }

  const meta = SOURCE_META[source];
  for (const file of files) {
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
  }

  if (source === 'whatsapp') return postWhatsapp(form, files, period);
  if (files.length > 1) {
    return NextResponse.json(
      { error: `${meta.label} takes one file per period, not ${files.length}.` },
      { status: 400 },
    );
  }
  if (files[0].size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is ${(files[0].size / 1024 / 1024).toFixed(1)} MB; the limit is 15 MB.` },
      { status: 413 },
    );
  }
  return source === 'ga4'
    ? postGa4(files[0], period)
    : postShortio(form, files[0], period);
}

/* --------------------------------------------------------------- WhatsApp */

/** What one file in a batch ended up as, for the per-file result list. */
interface BatchOutcome {
  filename: string;
  group: GroupSlug | null;
  groupLabel: string | null;
  /** How the group was worked out, e.g. 'chat group name'. Null when pinned by hand. */
  detectedFrom: string | null;
  ok: boolean;
  error: string | null;
  notes: string[];
  warnings: string[];
  aiGenerated: boolean;
}

async function postWhatsapp(
  form: FormData,
  files: File[],
  period: ReportPeriod,
): Promise<NextResponse> {
  const community = form.get('community');
  if (!isCommunitySlug(community)) {
    return NextResponse.json({ error: 'Unknown community.' }, { status: 400 });
  }
  if (files.length > MAX_BATCH_FILES) {
    return NextResponse.json(
      { error: `That's ${files.length} files; upload at most ${MAX_BATCH_FILES} at a time.` },
      { status: 400 },
    );
  }

  // A single file may name its group explicitly — the escape hatch for an
  // export whose name gives nothing away. It is never required.
  const pinnedRaw = form.get('group');
  const pinned = isGroupSlug(pinnedRaw) ? pinnedRaw : null;
  if (pinned && files.length > 1) {
    return NextResponse.json(
      { error: 'A group can only be pinned when uploading one file at a time.' },
      { status: 400 },
    );
  }
  if (pinned && getGroup(pinned)?.community !== community) {
    return NextResponse.json(
      { error: 'That group belongs to a different community.' },
      { status: 400 },
    );
  }

  const candidateGroups = groupsOf(community);
  const outcomes: BatchOutcome[] = [];
  const toSave: Omit<ImportedFile, 'id' | 'uploadedAt'>[] = [];
  // Group → the file that claimed it, so a second file for the same group is
  // reported as a clash rather than silently overwriting the first.
  const claimed = new Map<GroupSlug, string>();
  const startedAt = Date.now();
  const existingImports = await getImports();

  for (const file of files) {
    const isZip = file.name.toLowerCase().endsWith('.zip');
    const sizeLimit = isZip ? MAX_WHATSAPP_ZIP_BYTES : MAX_WHATSAPP_BYTES;
    if (file.size > sizeLimit) {
      outcomes.push(
        missOutcome(
          file.name,
          `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ` +
            `${sizeLimit / 1024 / 1024} MB${isZip ? ' for a "with media" export' : ''}.`,
        ),
      );
      continue;
    }

    let chatText: string;
    let chatFilename: string;
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      // "Include media" exports are a .zip — the chat .txt is pulled out of
      // it and everything else (photos, videos, voice notes) is discarded
      // without ever being decompressed.
      const extracted = isZip
        ? extractChatTextFromZip(buffer, file.name)
        : { text: buffer.toString('utf8'), filename: file.name };
      chatText = extracted.text;
      chatFilename = extracted.filename;
    } catch (err) {
      outcomes.push(
        missOutcome(file.name, err instanceof Error ? err.message : 'Could not read that file.'),
      );
      continue;
    }

    const detection: GroupDetection = pinned
      ? {
          group: pinned,
          destination: getGroup(pinned)?.name ?? null,
          evidence: null,
          matchedText: null,
          matchedAliases: [],
        }
      : detectGroup(
          detectionCandidates({
            uploadedFilename: file.name,
            archiveEntryName: isZip ? chatFilename : null,
            transcript: chatText,
          }),
          candidateGroups,
        );

    if (!detection.group) {
      outcomes.push(
        missOutcome(
          file.name,
          `Couldn't tell which group this is for. Nothing in the filename, the archive, or the ` +
            `chat's own name matched ${listDestinations(candidateGroups)}. Rename the file to ` +
            `include the country, or upload it on its own from that group's page.`,
        ),
      );
      continue;
    }

    const clash = claimed.get(detection.group);
    if (clash) {
      outcomes.push(
        missOutcome(
          file.name,
          `This also looks like the ${getGroup(detection.group)?.label} export, but “${clash}” ` +
            `already claimed it. Upload one file per group.`,
        ),
      );
      continue;
    }

    const groupConfig = getGroup(detection.group)!;
    try {
      // Activity level is measured against this group's own previous filed
      // period — looked up from what was already stored before this batch.
      const previous = previousGroupPeriod(existingImports, detection.group, period.start);
      const { figures, notes, warnings, periodMessages } = extractWhatsapp(
        chatText,
        chatFilename,
        period,
        previous?.whatsapp?.messageCount ?? null,
      );

      let aiGenerated = false;
      let aiSummary;
      if (groqEnabled() && periodMessages.length > 0 && Date.now() - startedAt < AI_BUDGET_MS) {
        const summary = await generateGroupSummary({
          groupLabel: groupConfig.label,
          communityLabel: getCommunity(groupConfig.community)?.label ?? groupConfig.community,
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

      const detectedFrom = detection.evidence
        ? `${detection.evidence}${detection.matchedText ? ` — “${detection.matchedText}”` : ''}`
        : null;

      // Warnings are persisted alongside notes (prefixed so they still read
      // as warnings later, not just more informational text), so checking
      // back on a stored period without re-uploading still shows why its
      // figures might be off.
      toSave.push({
        source: 'whatsapp',
        community: groupConfig.community,
        group: detection.group,
        periodStart: period.start,
        periodEnd: period.end,
        filename: file.name,
        notes: [
          ...notes,
          ...(detectedFrom ? [`Matched to ${groupConfig.label} by ${detectedFrom}.`] : []),
          ...warnings.map((w) => `⚠ ${w}`),
        ],
        whatsapp: figures,
        aiSummary,
      });

      claimed.set(detection.group, file.name);
      outcomes.push({
        filename: file.name,
        group: detection.group,
        groupLabel: groupConfig.label,
        detectedFrom,
        ok: true,
        error: null,
        notes,
        warnings,
        aiGenerated,
      });
    } catch (err) {
      outcomes.push(
        missOutcome(
          file.name,
          err instanceof Error ? err.message : 'Could not read that file.',
          detection.group,
          groupConfig.label,
        ),
      );
    }
  }

  if (toSave.length === 0) {
    return NextResponse.json(
      {
        error: 'None of those files could be filed.',
        period,
        results: outcomes,
        saved: 0,
      },
      { status: 422 },
    );
  }

  // One read-modify-write for the whole batch: saving row by row would race
  // on the same JSON document and can lose rows.
  await saveImports(toSave);
  await adoptPeriod(period);

  const missing = candidateGroups.filter((g) => !claimed.has(g.slug));
  return NextResponse.json({
    period,
    saved: toSave.length,
    results: outcomes,
    /** Groups in this community with no export in this batch — not an error, just unfiled. */
    missingGroups: missing.map((g) => ({ slug: g.slug, label: g.label })),
  });
}

function missOutcome(
  filename: string,
  error: string,
  group: GroupSlug | null = null,
  groupLabel: string | null = null,
): BatchOutcome {
  return {
    filename,
    group,
    groupLabel,
    detectedFrom: null,
    ok: false,
    error,
    notes: [],
    warnings: [],
    aiGenerated: false,
  };
}

function listDestinations(groups: GroupConfig[]): string {
  const names = groups.map((g) => g.label);
  if (names.length <= 1) return names[0] ?? 'this community’s groups';
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/* -------------------------------------------------------------------- GA4 */

async function postGa4(file: File, period: ReportPeriod): Promise<NextResponse> {
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { figures, notes, dateRange, daily } = extractGa4(buffer.toString('utf8'), file.name);

    // A snapshot filed under the wrong dates is the easy mistake to make, and
    // the numbers look perfectly plausible when it happens — so say so rather
    // than silently accepting it. The upload still goes through; it's the
    // user's call.
    const allNotes = [...notes];
    if (dateRange && (dateRange.start !== period.start || dateRange.end !== period.end)) {
      allNotes.push(
        `Heads up: this export covers ${dateRange.start} to ${dateRange.end}, but it has been ` +
          `filed under ${period.start} to ${period.end}.` +
          (daily.length > 0
            ? ' It has day-by-day rows, so the figures shown are summed from the days inside the filed period.'
            : ''),
      );
    }

    const stored = await saveImport({
      source: 'ga4',
      periodStart: period.start,
      periodEnd: period.end,
      filename: file.name,
      notes: allNotes,
      daily: daily.length > 0 ? daily : undefined,
      ga4: figures,
    });
    await adoptPeriod(period);
    return NextResponse.json({ import: stored });
  } catch (err) {
    return failure(err);
  }
}

/* --------------------------------------------------------------- Short.io */

async function postShortio(
  form: FormData,
  file: File,
  period: ReportPeriod,
): Promise<NextResponse> {
  // Short.io is Community #2's own link data specifically — a community is
  // required, and communityHasImport enforces it's Community #2 (the only
  // community that declares this capability in lib/groups.ts).
  const community = form.get('community');
  if (!isCommunitySlug(community)) {
    return NextResponse.json({ error: 'Unknown community.' }, { status: 400 });
  }
  if (!communityHasImport(community, 'shortio')) {
    return NextResponse.json(
      { error: `${SOURCE_META.shortio.label} is not enabled for this community.` },
      { status: 400 },
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { figures, notes, daily } = extractShortio(buffer, file.name);
    const stored = await saveImport({
      source: 'shortio',
      community,
      periodStart: period.start,
      periodEnd: period.end,
      filename: file.name,
      notes,
      daily: daily.length > 0 ? daily : undefined,
      shortio: figures,
    });
    await adoptPeriod(period);
    return NextResponse.json({ import: stored });
  } catch (err) {
    // A bad file is the user's problem to fix, and the message says how;
    // anything else is ours, and shouldn't be dressed up as a validation
    // failure.
    return failure(err);
  }
}

/* ------------------------------------------------------------------ DELETE */

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
