import { readZip } from '../zip';

/**
 * Parsing a WhatsApp chat export into messages and membership events.
 *
 * WHAT IS ACTUALLY IN THE FILE. An export is a ZIP containing `_chat.txt` (name
 * varies by locale and platform) and, optionally, media. The txt is a flat
 * transcript: one line per message, continuation lines for multi-line messages,
 * and system lines for group events. Two line formats are in circulation:
 *
 *   iOS      [27/07/2026, 14:32:11] Priya Sharma: Hello everyone
 *   Android  27/07/2026, 14:32 - Priya Sharma: Hello everyone
 *
 * with 12- or 24-hour clocks, `/` or `.` or `-` date separators, and
 * day-first or month-first order depending on the phone's locale.
 *
 * WHAT IS NOT IN THE FILE, so that no caller goes looking:
 *   • Poll votes. The poll question may appear; per-option counts never do.
 *   • Direct messages. A group export contains only that group's chat.
 *   • A member roster or a member count. Only join/leave EVENTS appear, so an
 *     absolute headcount is recoverable only when the export reaches back to the
 *     group's creation (see `createdAt` below).
 *   • Which link a joiner clicked. "joined using this group's invite link" does
 *     not say whether they came via Short.io or the landing page.
 *
 * PRIVACY. This module returns sender names because the analysis needs to count
 * distinct participants — but nothing downstream stores them: `analyse.ts` hashes
 * them to count uniques and keeps no identifiers. See lib/whatsapp/store.ts.
 */

export class WhatsAppParseError extends Error {}

export interface ChatMessage {
  /** ISO timestamp. */
  at: string;
  /** Sender as written in the export. Never persisted — counted, then dropped. */
  sender: string;
  text: string;
  /** True when the body was WhatsApp's placeholder for an attachment. */
  isAttachment: boolean;
}

export type MembershipKind =
  /** "X joined using this group's invite link" — self-serve, via a link. */
  | 'joined_via_link'
  /** "A added B" — an admin put them in. */
  | 'added'
  /** "X left" */
  | 'left'
  /** "A removed B" */
  | 'removed';

export interface MembershipEvent {
  at: string;
  kind: MembershipKind;
  /** How many members the event moved. `added` can name several people at once. */
  count: number;
}

export interface ParsedChat {
  messages: ChatMessage[];
  events: MembershipEvent[];
  /** Poll questions found, for reporting. Votes are never in the export. */
  pollQuestions: string[];
  /** ISO timestamp of the group-creation line, when the export reaches it. */
  createdAt: string | null;
  /** The transcript's first and last message timestamps. */
  firstAt: string | null;
  lastAt: string | null;
  /** Diagnostics surfaced in the import panel. */
  report: {
    fileName: string;
    totalLines: number;
    messageLines: number;
    systemLines: number;
    /** System lines we recognised as an event, by kind. */
    eventCounts: Record<MembershipKind, number>;
    /** System lines we could not classify — the honest "unknown" bucket. */
    unrecognisedSystemLines: number;
    /**
     * A few unclassified examples, so an unhandled locale is diagnosable —
     * NAME-REDACTED. See `redactNames`: an unrecognised system line is usually
     * "<Person> changed this group's icon", and storing it verbatim would put a
     * participant's name on disk, which this module promises not to do.
     */
    samples: string[];
    dateOrder: 'day-first' | 'month-first' | 'unknown';
  };
}

/* -------------------------------------------------------------- the archive */

/** Find the transcript inside the export. */
function findTranscript(buffer: Buffer, filename: string): { name: string; text: string } {
  let entries;
  try {
    entries = readZip(buffer);
  } catch (err) {
    throw new WhatsAppParseError(
      `${filename} could not be read as a .zip` +
        `${err instanceof Error ? `: ${err.message}` : '.'}`,
    );
  }

  // `_chat.txt` on iOS; "WhatsApp Chat with <name>.txt" on Android; localised
  // variants of both. Any .txt member is a better guess than failing.
  const candidates = entries.filter((e) => e.name.toLowerCase().endsWith('.txt'));
  if (candidates.length === 0) {
    throw new WhatsAppParseError(
      `${filename} contains no .txt transcript. Export the chat from WhatsApp with ` +
        `"Without media" — files found: ${entries.map((e) => e.name).join(', ') || 'none'}.`,
    );
  }

  const preferred =
    candidates.find((e) => /(^|\/)_chat\.txt$/i.test(e.name)) ??
    // The largest .txt is the transcript when the name is unfamiliar.
    candidates.sort((a, b) => b.data.length - a.data.length)[0];

  return { name: preferred.name, text: preferred.data.toString('utf8') };
}

/* ------------------------------------------------------------- line parsing */

/**
 * A message or system line's prefix.
 *
 * The two platform formats differ enough to need two patterns, but both end with
 * the same thing: a timestamp, then either "Sender: body" or a bare system body.
 */
const LINE_PATTERNS: RegExp[] = [
  // iOS: [27/07/2026, 14:32:11] rest    (also [27/07/2026, 2:32:11 PM])
  /^‎?\[(\d{1,4}[/.\-]\d{1,2}[/.\-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*([APap][Mm])?\]\s*‎?(.*)$/,
  // Android: 27/07/2026, 14:32 - rest
  /^‎?(\d{1,4}[/.\-]\d{1,2}[/.\-]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*([APap][Mm])?\s+-\s+‎?(.*)$/,
];

interface RawLine {
  dateText: string;
  timeText: string;
  meridiem: string | undefined;
  body: string;
}

function matchLine(line: string): RawLine | null {
  for (const pattern of LINE_PATTERNS) {
    const m = pattern.exec(line);
    if (m) {
      return { dateText: m[1], timeText: m[2], meridiem: m[3], body: m[4] ?? '' };
    }
  }
  return null;
}

/**
 * Decide whether dates are day-first or month-first for the whole file.
 *
 * A single line is often ambiguous (03/04 is either), but a transcript of any
 * length usually contains a day above 12, which settles it. Defaulting to
 * day-first is the right guess when it doesn't: WhatsApp's day-first locales
 * outnumber month-first ones, and the consequence of being wrong is confined to
 * which week a message lands in.
 */
function detectDateOrder(lines: RawLine[]): 'day-first' | 'month-first' | 'unknown' {
  for (const line of lines) {
    const parts = line.dateText.split(/[/.\-]/).map(Number);
    if (parts.length < 2) continue;
    if (parts[0] > 12 && parts[1] <= 12) return 'day-first';
    if (parts[1] > 12 && parts[0] <= 12) return 'month-first';
  }
  return 'unknown';
}

function toIso(line: RawLine, order: 'day-first' | 'month-first' | 'unknown'): string | null {
  const parts = line.dateText.split(/[/.\-]/).map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;

  let day: number;
  let month: number;
  let year: number;

  if (parts[0] > 31) {
    // Already year-first: 2026/07/27.
    [year, month, day] = parts;
  } else if (order === 'month-first') {
    [month, day, year] = parts;
  } else {
    [day, month, year] = parts;
  }

  if (year < 100) year += 2000;

  const [hourRaw, minute, second = 0] = line.timeText.split(':').map(Number);
  let hour = hourRaw;
  const meridiem = line.meridiem?.toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/* --------------------------------------------------------- system-line rules */

/**
 * System lines that describe membership.
 *
 * English only, deliberately: guessing at a locale we haven't seen would produce
 * confidently wrong counts. Anything unmatched lands in `unrecognisedSystemLines`
 * and is reported, so a non-English export is visible rather than silently
 * counted as zero joins.
 */
const EVENT_RULES: { kind: MembershipKind; pattern: RegExp; countFrom?: 'list' }[] = [
  { kind: 'joined_via_link', pattern: /\bjoined using this group'?s invite link\b/i },
  { kind: 'joined_via_link', pattern: /\bjoined from the community\b/i },
  { kind: 'added', pattern: /\badded\b/i, countFrom: 'list' },
  { kind: 'removed', pattern: /\bremoved\b/i, countFrom: 'list' },
  { kind: 'left', pattern: /\bleft\b/i },
];

const CREATED_PATTERN = /\bcreated (?:this )?group\b/i;
const POLL_PATTERN = /^‎?POLL:\s*(.+)$/i;

/**
 * A system line has no "Sender: " prefix. Detecting that reliably is the crux of
 * separating events from messages, and a message whose text happens to contain a
 * colon must not be mistaken for one.
 *
 * Rule: a message prefix is "Name: " where Name has no line-ending punctuation
 * and is reasonably short. Everything else at a timestamp is a system line.
 */
const SENDER_PATTERN = /^([^:\n]{1,80}?):\s([\s\S]*)$/;

/** How many people an "added"/"removed" line names. "A added B and C" → 2. */
function namedCount(body: string, verb: 'added' | 'removed'): number {
  const after = body.split(new RegExp(`\\b${verb}\\b`, 'i'))[1];
  if (!after) return 1;
  const names = after
    .split(/,| and /i)
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return Math.max(1, names.length);
}

/**
 * Replace probable person-names in a diagnostic line with "[name]".
 *
 * Needed because the samples exist to show an unhandled PHRASING, not who it was
 * about — and a verbatim sample leaks an identity into data/whatsapp.json. Two
 * passes: any known message sender, then any remaining run of capitalised words,
 * which is what a name looks like in these lines.
 *
 * Over-redaction is the safe direction here: losing "Group" from a sample costs a
 * little clarity, keeping "Priya Sharma" costs a person's name.
 */
function redactNames(line: string, senders: Set<string>): string {
  let out = line;
  for (const sender of senders) {
    if (sender.length < 2) continue;
    out = out.split(sender).join('[name]');
  }
  // Runs of capitalised words, and +country-code phone numbers.
  return out
    .replace(/\+\d[\d\s\-()]{6,}\d/g, '[phone]')
    .replace(/\b(\p{Lu}\p{L}+(?:\s+\p{Lu}\p{L}+)*)/gu, (match) =>
      // Keep single common words that start a sentence; redact multi-word runs
      // and anything that isn't a recognisable English opener.
      match.includes(' ') ? '[name]' : match,
    );
}

const ATTACHMENT_PATTERN =
  /(<attached:|<Media omitted>|image omitted|video omitted|audio omitted|sticker omitted|document omitted|GIF omitted)/i;

/* ------------------------------------------------------------------- parsing */

export function parseChatExport(buffer: Buffer, filename: string): ParsedChat {
  const { name, text } = findTranscript(buffer, filename);
  const lines = text.split(/\r?\n/);

  // Pass one: attach continuation lines to their parent, so a multi-line message
  // is one message rather than several unparseable fragments.
  const grouped: { raw: RawLine; extra: string[] }[] = [];
  for (const line of lines) {
    if (line.trim() === '') continue;
    const match = matchLine(line);
    if (match) grouped.push({ raw: match, extra: [] });
    else if (grouped.length > 0) grouped[grouped.length - 1].extra.push(line);
    // A continuation with no parent is a stray header line; ignore it.
  }

  if (grouped.length === 0) {
    throw new WhatsAppParseError(
      `${filename} has no lines in a recognisable WhatsApp format. The transcript ` +
        `(${name}) should have lines like "[27/07/2026, 14:32:11] Name: message".`,
    );
  }

  const order = detectDateOrder(grouped.map((g) => g.raw));

  const messages: ChatMessage[] = [];
  const events: MembershipEvent[] = [];
  const pollQuestions: string[] = [];
  const eventCounts: Record<MembershipKind, number> = {
    joined_via_link: 0,
    added: 0,
    left: 0,
    removed: 0,
  };
  const samples: string[] = [];
  /** Sender names, used only to redact diagnostic samples. Never returned. */
  const senderNames = new Set<string>();
  let createdAt: string | null = null;
  let systemLines = 0;
  let unrecognised = 0;

  for (const { raw, extra } of grouped) {
    const at = toIso(raw, order);
    if (at === null) continue;

    const fullBody = [raw.body, ...extra].join('\n').trim();
    const senderMatch = SENDER_PATTERN.exec(raw.body);

    // Encryption notices and similar carry no sender and no membership meaning.
    if (senderMatch) {
      const sender = senderMatch[1].trim();
      const body = [senderMatch[2], ...extra].join('\n').trim();

      const poll = POLL_PATTERN.exec(body);
      if (poll) {
        pollQuestions.push(poll[1].trim());
        continue;
      }

      senderNames.add(sender);
      messages.push({
        at,
        sender,
        text: body,
        isAttachment: ATTACHMENT_PATTERN.test(body),
      });
      continue;
    }

    // No sender → a system line.
    systemLines += 1;

    if (createdAt === null && CREATED_PATTERN.test(fullBody)) {
      createdAt = at;
      continue;
    }

    const rule = EVENT_RULES.find((r) => r.pattern.test(fullBody));
    if (!rule) {
      unrecognised += 1;
      // Redacted before it is ever stored — see redactNames.
      if (samples.length < 5) {
        samples.push(redactNames(fullBody, senderNames).slice(0, 120));
      }
      continue;
    }

    const count =
      rule.countFrom === 'list'
        ? namedCount(fullBody, rule.kind === 'added' ? 'added' : 'removed')
        : 1;
    eventCounts[rule.kind] += count;
    events.push({ at, kind: rule.kind, count });
  }

  return {
    messages,
    events,
    pollQuestions,
    createdAt,
    firstAt: messages[0]?.at ?? events[0]?.at ?? null,
    lastAt:
      messages[messages.length - 1]?.at ?? events[events.length - 1]?.at ?? null,
    report: {
      fileName: name,
      totalLines: grouped.length,
      messageLines: messages.length,
      systemLines,
      eventCounts,
      unrecognisedSystemLines: unrecognised,
      samples,
      dateOrder: order,
    },
  };
}
