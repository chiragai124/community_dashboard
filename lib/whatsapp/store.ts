import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ActivityLevel, GroupSlug, SentimentKey } from '../types';
import { isGroupSlug } from '../groups';
import { parseISODate, weekStartOf } from '../weeks';
import type { WhatsAppAnalysis, WhatsAppWeek } from './analyse';

/**
 * Persistence for chat-export analysis.
 *
 * ONE RECORD PER GROUP, not per week. A chat export carries the whole history
 * available on the device, so a single upload backfills every week it covers and
 * re-uploading REPLACES that group's record outright. Merging would be wrong:
 * the new file is a superset, and adding it to the old one would double every
 * week they share.
 *
 * WHAT REACHES DISK. Counts, term frequencies, question text, sentiment
 * percentages, and up to three example messages per sentiment per week. What does
 * NOT reach disk: the transcript, sender names, and phone numbers. The uploaded
 * .zip is parsed in memory and discarded — nothing writes it anywhere.
 *
 * `data/` is gitignored, and nothing in this codebase makes an outbound request,
 * so the exposure is exactly "whoever can read this disk".
 */

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'whatsapp.json');

export interface GroupChatImport {
  group: GroupSlug;
  filename: string;
  uploadedAt: string;
  membersKnown: boolean;
  notes: string[];
  report: WhatsAppAnalysis['report'];
  weeks: WhatsAppWeek[];
}

/* --------------------------------------------------------- normalisation -- */

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function optionalNum(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

function strings(value: unknown, cap = 400): string[] {
  return Array.isArray(value)
    ? value.map((v) => String(v ?? '').slice(0, cap)).filter((v) => v !== '')
    : [];
}

function normalizeWeek(raw: Record<string, unknown>): WhatsAppWeek | null {
  const weekRaw = String(raw.weekStart ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekRaw)) return null;

  const level = raw.activityLevel;
  const activityLevel: ActivityLevel | null =
    level === 'Low' || level === 'Medium' || level === 'High' ? level : null;

  const sentimentRaw = (raw.sentiment ?? {}) as Record<string, unknown>;
  const examplesRaw = (sentimentRaw.examples ?? {}) as Record<string, unknown>;
  const examples = {} as Record<SentimentKey, string[]>;
  for (const key of ['positive', 'neutral', 'negative'] as SentimentKey[]) {
    examples[key] = strings(examplesRaw[key]).slice(0, 3);
  }

  return {
    weekStart: weekStartOf(parseISODate(weekRaw)),
    messages: num(raw.messages),
    activeParticipants: num(raw.activeParticipants),
    joinedViaLink: num(raw.joinedViaLink),
    addedByAdmin: num(raw.addedByAdmin),
    left: num(raw.left),
    removed: num(raw.removed),
    netChange: num(raw.netChange),
    members: optionalNum(raw.members),
    activityLevel,
    topics: Array.isArray(raw.topics)
      ? raw.topics
          .map((t) => {
            const term = t as Record<string, unknown>;
            return {
              term: String(term.term ?? '').slice(0, 60),
              messages: num(term.messages),
              score: Number(term.score) || 0,
            };
          })
          .filter((t) => t.term !== '')
      : [],
    questions: Array.isArray(raw.questions)
      ? raw.questions
          .map((q) => {
            const question = q as Record<string, unknown>;
            return {
              text: String(question.text ?? '').slice(0, 300),
              asked: num(question.asked, 1),
            };
          })
          .filter((q) => q.text !== '')
      : [],
    sentiment: {
      positivePct: optionalNum(sentimentRaw.positivePct),
      neutralPct: optionalNum(sentimentRaw.neutralPct),
      negativePct: optionalNum(sentimentRaw.negativePct),
      examples,
      scored: num(sentimentRaw.scored),
      withSignal: num(sentimentRaw.withSignal),
    },
  };
}

function normalize(raw: Record<string, unknown>): GroupChatImport | null {
  if (!isGroupSlug(raw.group)) return null;
  const weeks = Array.isArray(raw.weeks)
    ? raw.weeks
        .map((w) => normalizeWeek(w as Record<string, unknown>))
        .filter((w): w is WhatsAppWeek => w !== null)
        .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1))
    : [];

  const reportRaw = (raw.report ?? {}) as Record<string, unknown>;
  const eventsRaw = (reportRaw.eventCounts ?? {}) as Record<string, unknown>;

  return {
    group: raw.group,
    filename: String(raw.filename ?? 'chat.zip'),
    uploadedAt: String(raw.uploadedAt ?? new Date().toISOString()),
    membersKnown: raw.membersKnown === true,
    notes: strings(raw.notes, 600),
    report: {
      fileName: String(reportRaw.fileName ?? ''),
      totalLines: num(reportRaw.totalLines),
      messageLines: num(reportRaw.messageLines),
      systemLines: num(reportRaw.systemLines),
      eventCounts: {
        joined_via_link: num(eventsRaw.joined_via_link),
        added: num(eventsRaw.added),
        left: num(eventsRaw.left),
        removed: num(eventsRaw.removed),
      },
      unrecognisedSystemLines: num(reportRaw.unrecognisedSystemLines),
      samples: strings(reportRaw.samples, 200),
      dateOrder:
        reportRaw.dateOrder === 'month-first'
          ? 'month-first'
          : reportRaw.dateOrder === 'day-first'
            ? 'day-first'
            : 'unknown',
    },
    weeks,
  };
}

/* ------------------------------------------------------------------ access -- */

export async function getChatImports(): Promise<GroupChatImport[]> {
  try {
    const text = await fs.readFile(STORE_FILE, 'utf8');
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => normalize(row as Record<string, unknown>))
      .filter((r): r is GroupChatImport => r !== null);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function saveChatImport(
  analysis: WhatsAppAnalysis,
  filename: string,
): Promise<GroupChatImport> {
  const record: GroupChatImport = {
    group: analysis.group,
    filename,
    uploadedAt: new Date().toISOString(),
    membersKnown: analysis.membersKnown,
    notes: analysis.notes,
    report: analysis.report,
    weeks: analysis.weeks,
  };

  // Replace this group's record outright — see the file header.
  const others = (await getChatImports()).filter((r) => r.group !== record.group);
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    STORE_FILE,
    `${JSON.stringify([...others, record], null, 2)}\n`,
    'utf8',
  );
  return record;
}

export async function deleteChatImport(group: string): Promise<boolean> {
  const current = await getChatImports();
  const next = current.filter((r) => r.group !== group);
  if (next.length === current.length) return false;
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return true;
}

/* --------------------------------------------------------------- selectors -- */

/**
 * Re-exported from ./select.ts, which holds no file I/O. Anything that only needs
 * to LOOK UP a week should import from there directly — importing this module
 * pulls in node:fs, which cannot be bundled for the browser.
 */
export { chatWeekFor } from './select';
export { chatRecordFor as chatImportFor } from './select';
