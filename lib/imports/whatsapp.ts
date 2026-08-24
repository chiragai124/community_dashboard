import type { ActivityLevel, SentimentBreakdown, Voice, WhatsappFigures } from '../types';
import { emptySentiment } from '../types';
import { toISODate } from '../weeks';
import { listZipEntries, readZipEntryData } from '../zip';
import { ImportError } from './shortio';

/**
 * Turning a WhatsApp export into message-level figures for one
 * manually-entered date range.
 *
 * Deliberately does NOT compute a member count: an export's join/add/leave/
 * remove system messages are not a reliable full history (WhatsApp doesn't
 * guarantee older events survive in a given export, depending on export
 * settings and app version), so a replay-based total silently undercounts.
 * Total membership is tracked separately as a manual entry per community —
 * see lib/community-members.ts.
 *
 * Everything here is a local heuristic (word lists and frequency counts, no
 * network call) — this app has no API keys and nothing it reads ever leaves
 * the machine, and chat text is exactly the kind of thing that shouldn't.
 */

/* ---------------------------------------------------------- "with media" zip */

/**
 * WhatsApp's "Export chat" → "Include media" produces a .zip containing the
 * chat transcript as a single .txt entry (named `_chat.txt` on iOS, or
 * `WhatsApp Chat with <name>.txt` on Android) alongside every attached photo,
 * video and voice note. Only that one .txt entry is ever decompressed here —
 * see lib/zip.ts's module doc for why that matters for a large archive.
 */
export function extractChatTextFromZip(buffer: Buffer, filename: string): { text: string; filename: string } {
  let entries;
  try {
    entries = listZipEntries(buffer);
  } catch {
    throw new ImportError(
      `${filename} could not be read as a ZIP archive. Make sure this is the .zip WhatsApp ` +
        `produced for "Export chat" → "Include media", uploaded as-is.`,
    );
  }

  const txtEntries = entries.filter((e) => !e.name.endsWith('/') && /\.txt$/i.test(e.name));
  if (txtEntries.length === 0) {
    throw new ImportError(
      `${filename} doesn't contain a chat .txt file. Make sure this is the .zip from ` +
        `WhatsApp's "Export chat" → "Include media", not some other archive.`,
    );
  }

  // WhatsApp's own chat file is almost always named with "chat" in it
  // ("_chat.txt", "WhatsApp Chat with X.txt"); prefer that, then fall back to
  // the largest .txt entry — a stray small text file is more likely to be
  // something else than the transcript.
  const chatEntry =
    txtEntries.find((e) => /chat/i.test(e.name)) ??
    [...txtEntries].sort((a, b) => b.compressedSize - a.compressedSize)[0];

  const raw = readZipEntryData(buffer, chatEntry);
  // Strip a UTF-8 BOM if present — some exports include one.
  const text = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf
    ? raw.subarray(3).toString('utf8')
    : raw.toString('utf8');

  return { text, filename: chatEntry.name };
}

/* -------------------------------------------------------------- line parsing */

interface RawMessage {
  date: Date;
  sender: string;
  text: string;
}

/** Narrow no-break space (U+202F) shows up before AM/PM on iOS exports. */
function normalizeLine(line: string): string {
  return line.replace(/[  ]/g, ' ').replace(/\r$/, '');
}

/** Android: `DD/MM/YYYY, HH:MM(:SS) (AM/PM) - rest`. */
const ANDROID_START =
  /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\s*[-–]\s*(.*)$/;
/** iOS: `[DD/MM/YYYY, HH:MM(:SS) (AM/PM)] rest`. */
const IOS_START =
  /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\]\s*(.*)$/;

/**
 * Which date order a whole export uses — decided ONCE for the entire file,
 * not line by line.
 *
 * A per-line guess (e.g. "swap only when the second component is >12") is
 * unreliable across a real export: most days in a month are ≤12, so a
 * US-locale (MM/DD) file where the day also happens to be ≤12 reads as
 * plausible DD/MM on every one of those lines — silently swapping day and
 * month rather than erroring. That scatters real messages across the wrong
 * weeks all year, which is exactly "upload succeeds, but the numbers for the
 * week I'm looking at are blank": the data exists, just filed under the
 * wrong dates. A single unambiguous line anywhere in the file (a component
 * over 12, which can only be a day) settles the format for every line.
 */
function inferDateFormat(text: string): { format: 'day-first' | 'month-first'; confident: boolean } {
  let dayFirstSignal = false;
  let monthFirstSignal = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = normalizeLine(rawLine);
    const match = ANDROID_START.exec(line) ?? IOS_START.exec(line);
    if (!match) continue;
    if (Number(match[1]) > 12) dayFirstSignal = true;
    if (Number(match[2]) > 12) monthFirstSignal = true;
  }
  if (dayFirstSignal && !monthFirstSignal) return { format: 'day-first', confident: true };
  if (monthFirstSignal && !dayFirstSignal) return { format: 'month-first', confident: true };
  // Every date in the file had both parts ≤12 (short export) or somehow
  // contradicted itself (shouldn't happen for one consistent file) — default
  // to day-first, same as before, but flagged as a guess rather than settled.
  return { format: 'day-first', confident: false };
}

function toDate(
  a: number,
  b: number,
  year: number,
  hour: number,
  minute: number,
  second: number,
  ampm: string | undefined,
  format: 'day-first' | 'month-first',
): Date {
  let day = format === 'day-first' ? a : b;
  let month = format === 'day-first' ? b : a;
  // Safety net for one stray line that contradicts the file's own inferred
  // format (a typo in the export, say) — an impossible month always means
  // day and month landed backwards.
  if (month > 12 && day <= 12) {
    [day, month] = [month, day];
  }
  const y = year < 100 ? 2000 + year : year;
  let h = hour;
  if (ampm) {
    const isPm = ampm.toLowerCase() === 'pm';
    if (isPm && h < 12) h += 12;
    if (!isPm && h === 12) h = 0;
  }
  // Treated as UTC wall-clock time: only relative ordering and week-bucketing
  // matter here, not the sender's real timezone.
  return new Date(Date.UTC(y, month - 1, day, h, minute, second));
}

/**
 * Known system-message shapes (joins, leaves, admin changes, group settings
 * changes, and the like): recognised so they're never mis-parsed as a real
 * chat message, but not counted as anything — this module no longer tracks
 * membership at all (see the module doc), so joins/leaves don't need their
 * own event type, just exclusion from the message stream.
 */
const IGNORED_SYSTEM_RE =
  /(end-to-end encrypted|created (this )?group|changed the (subject|group description|icon)|changed this group'?s icon|changed their phone number|security code (with|changed)|(removed|added) .+ as (an )?admin|now an admin|is an admin|no longer an admin|disappearing messages|message was deleted|deleted this message|pinned a message|changed the group settings|turned off admin approval|turned on admin approval|reset (this|the) group'?s invite link|group settings changed|joined using this group'?s invite link|joined from the community|was added$|was removed$|^.+? added .+$|^.+? removed .+$|left( the group)?$)/i;

export interface ParsedWhatsapp {
  messages: RawMessage[];
  /** System lines that matched neither a known event nor a known ignore pattern. */
  unrecognizedSystemLines: number;
  /** A few actual unrecognised lines, verbatim — so a mismatch is debuggable without re-reading the whole export. */
  unrecognizedExamples: string[];
  /**
   * Non-blank lines that were neither a recognised message-start nor a
   * continuation of one (i.e. there was no message open to attach them to).
   * A high count relative to `totalLines` means this file's format probably
   * isn't matching the parser's timestamp patterns at all, not that the
   * export is merely quiet.
   */
  orphanLines: number;
  orphanExamples: string[];
  /** Every non-blank line scanned — the denominator for the recognition-rate check. */
  totalLines: number;
  /** Lines that matched the Android or iOS message-start timestamp pattern. */
  matchedStartLines: number;
  dateFormat: 'day-first' | 'month-first';
  /** False when the format above is a default guess, not confirmed by an unambiguous date. */
  dateFormatConfident: boolean;
}

/**
 * Parse the raw export into a flat, chronological list of messages. A line
 * with no timestamp prefix continues the previous message (WhatsApp wraps a
 * multi-line message this way).
 */
export function parseWhatsappExport(text: string): ParsedWhatsapp {
  const { format, confident } = inferDateFormat(text);

  const messages: RawMessage[] = [];
  let unrecognizedSystemLines = 0;
  const unrecognizedExamples: string[] = [];
  let orphanLines = 0;
  const orphanExamples: string[] = [];
  let totalLines = 0;
  let matchedStartLines = 0;
  let current: RawMessage | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = normalizeLine(rawLine);
    if (line.trim() === '') continue;
    totalLines += 1;

    const match = ANDROID_START.exec(line) ?? IOS_START.exec(line);
    if (!match) {
      // Continuation of the previous message, if there is one to attach to —
      // otherwise this line couldn't be attributed to anything.
      if (current) {
        current.text += `\n${line}`;
      } else {
        orphanLines += 1;
        if (orphanExamples.length < 3) orphanExamples.push(line.slice(0, 200));
      }
      continue;
    }
    matchedStartLines += 1;

    const [, aRaw, bRaw, yearRaw, hourRaw, minuteRaw, secondRaw, ampm, rest] = match;
    const date = toDate(
      Number(aRaw),
      Number(bRaw),
      Number(yearRaw),
      Number(hourRaw),
      Number(minuteRaw),
      secondRaw ? Number(secondRaw) : 0,
      ampm,
      format,
    );

    current = null; // the previous message, if any, is done — a new line has started

    if (IGNORED_SYSTEM_RE.test(rest)) continue;

    // A real message is always "Sender: text" — system notices never contain
    // that separator, so its absence here means an unrecognised system line.
    const sep = rest.indexOf(': ');
    if (sep === -1) {
      unrecognizedSystemLines += 1;
      if (unrecognizedExamples.length < 3) unrecognizedExamples.push(rest.slice(0, 200));
      continue;
    }
    const sender = rest.slice(0, sep).trim();
    const bodyText = rest.slice(sep + 2);
    current = { date, sender, text: bodyText };
    messages.push(current);
  }

  return {
    messages,
    unrecognizedSystemLines,
    unrecognizedExamples,
    orphanLines,
    orphanExamples,
    totalLines,
    matchedStartLines,
    dateFormat: format,
    dateFormatConfident: confident,
  };
}

/* --------------------------------------------------------------- lexicons */

const STOPWORDS = new Set(
  (
    'a an the and or but if then so to of in on at for with from by as is are was were ' +
    'be been being have has had do does did will would can could should may might must ' +
    'i me my we our you your he she it they them his her its their this that these those ' +
    'not no yes ok okay yeah yep nope thanks thank pls please just also very really ' +
    'about into over under again further here there when where why how all any both each ' +
    'few more most other some such only own same than too very s t don now u im ur hi hey ' +
    'got get getting got go going gone one two three time day week today tomorrow yesterday ' +
    'everyone anyone someone everybody somebody anybody something everything nothing know ' +
    'still wait waiting well back thanks thank congrats congratulations awesome amazing ' +
    'great excited help helped helpful reply replies much many sure want needs think like ' +
    "i'm im ive i've youre you're theyre they're its it's dont don't didnt didn't cant can't " +
    "wont won't isnt isn't wasnt wasn't were're whats what's thats that's lets let's"
  ).split(/\s+/),
);

const POSITIVE_WORDS = new Set(
  (
    'good great awesome amazing excellent perfect thanks thank thankyou helpful nice love ' +
    'loved loving best wonderful fantastic brilliant appreciate appreciated glad happy ' +
    'excited excellent super cool easy smooth quick fast worked works booked confirmed ' +
    'approved congrats congratulations yay woohoo pleased grateful superb outstanding ' +
    'impressive delighted relief relieved sorted done finally success successful helpful ' +
    'kind generous friendly welcoming supportive'
  ).split(/\s+/),
);

const NEGATIVE_WORDS = new Set(
  (
    'bad worst terrible awful horrible annoying frustrated frustrating confusing confused ' +
    'delay delayed late slow problem issue issues broken error errors fail failed failing ' +
    'worried worry concern concerned unhappy disappointed disappointing rejected reject ' +
    'refused refusal denied denial scam scammed misleading unfair rude ignored waiting ' +
    'stuck lost missed miss difficult hard trouble expensive overpriced complaint complain ' +
    'angry upset stressed stressful nightmare unresponsive never'
  ).split(/\s+/),
);

const TITLE_WORDS = new Set(['ielts', 'usa', 'uk']);

function words(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).filter((w) => w.length > 0);
}

function titleCase(word: string): string {
  if (TITLE_WORDS.has(word)) return word.toUpperCase();
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Placeholder message bodies that carry no real text to analyse. */
function isPlaceholder(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    t === '<media omitted>' ||
    t === 'this message was deleted' ||
    t === 'you deleted this message' ||
    /^https?:\/\/\S+$/.test(t)
  );
}

/**
 * Top ~6 frequent words across a week's messages, title-cased for display,
 * ranked most-frequent first — so `topics[0]` is already "the trending
 * topic", not a separate computation. `topMentions` is that word's raw hit
 * count, carried alongside for display (e.g. "mentioned 42 times") rather
 * than recomputed later from a list that no longer has the number attached.
 */
function extractTopics(texts: string[]): { topics: string[]; topMentions: number | null } {
  const counts = new Map<string, number>();
  for (const text of texts) {
    if (isPlaceholder(text)) continue;
    for (const word of words(text)) {
      if (word.length < 3 || STOPWORDS.has(word) || /^\d+$/.test(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return {
    topics: ranked.slice(0, 6).map(([word]) => titleCase(word)),
    topMentions: ranked.length > 0 ? ranked[0][1] : null,
  };
}

/** Distinct senders and their message counts, most-active first, up to 5. */
function extractTopVoices(entries: { sender: string; text: string }[]): {
  uniqueActiveChatters: number;
  topVoices: Voice[];
} {
  const counts = new Map<string, number>();
  for (const { sender, text } of entries) {
    if (isPlaceholder(text) && text.trim() === '') continue;
    counts.set(sender, (counts.get(sender) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return {
    uniqueActiveChatters: counts.size,
    topVoices: ranked.slice(0, 5).map(([name, count]) => ({ name, count })),
  };
}

/** Sentiment split for a week's messages, by simple positive/negative word-hit count. */
function extractSentiment(texts: string[]): SentimentBreakdown {
  const usable = texts.filter((t) => !isPlaceholder(t));
  if (usable.length === 0) return emptySentiment();

  const scored = usable.map((text) => {
    const tokens = words(text);
    let pos = 0;
    let neg = 0;
    for (const token of tokens) {
      if (POSITIVE_WORDS.has(token)) pos += 1;
      if (NEGATIVE_WORDS.has(token)) neg += 1;
    }
    const bucket: 'positive' | 'neutral' | 'negative' =
      pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral';
    return { text, bucket, margin: Math.abs(pos - neg) };
  });

  const count = (bucket: 'positive' | 'neutral' | 'negative') =>
    scored.filter((s) => s.bucket === bucket).length;
  const pct = (n: number) => Math.round((n / usable.length) * 1000) / 10;

  const examplesFor = (bucket: 'positive' | 'neutral' | 'negative') =>
    scored
      .filter((s) => s.bucket === bucket && s.margin > 0)
      .sort((a, b) => b.margin - a.margin || b.text.length - a.text.length)
      .slice(0, 3)
      .map((s) => s.text.trim().slice(0, 400));

  return {
    positivePct: pct(count('positive')),
    neutralPct: pct(count('neutral')),
    negativePct: pct(count('negative')),
    examples: {
      positive: examplesFor('positive'),
      neutral: examplesFor('neutral'),
      negative: examplesFor('negative'),
    },
  };
}

/* ------------------------------------------------------- per-period figures */

/** An inclusive, manually-entered date range — see the module doc below. */
export interface DateRange {
  start: string;
  end: string;
}

export interface WhatsappExtract {
  figures: WhatsappFigures;
  /** Plain informational summary — always shown, nothing wrong implied. */
  notes: string[];
  /**
   * Surfaced distinctly from `notes`: something about this upload probably
   * isn't right, even though it didn't fail outright. This is what makes a
   * silent "parsed fine, numbers just happen to be blank" upload visible
   * instead of indistinguishable from a genuinely quiet period.
   */
  warnings: string[];
  /**
   * Real (non-placeholder) messages from within the requested range, capped,
   * for feeding the Groq AI-summary call (see lib/ai/groq.ts and the imports
   * API route) — nothing here is persisted to disk; it exists only for the
   * duration of that one upload request.
   */
  periodMessages: { sender: string; text: string }[];
}

/**
 * Extract figures for exactly the manually-entered `range` — not every week
 * the export happens to cover. The export itself should still be the
 * group's FULL history (WhatsApp has no way to export a partial date range
 * anyway, and `totalMembers` needs the full join/leave history to replay
 * accurately through `range.end`); only the message-level figures
 * (messages, active chatters, top voices, topics, sentiment) are scoped to
 * `range`. `previousMessageCount` — this group's message count for whatever
 * period was filed immediately before this one, or null if none exists —
 * is what activity level is compared against; the caller (the imports API
 * route) looks that up from already-stored periods.
 */
export function extractWhatsapp(
  text: string,
  filename: string,
  range: DateRange,
  previousMessageCount: number | null,
): WhatsappExtract {
  const {
    messages,
    unrecognizedSystemLines,
    unrecognizedExamples,
    orphanLines,
    orphanExamples,
    totalLines,
    matchedStartLines,
    dateFormat,
    dateFormatConfident,
  } = parseWhatsappExport(text);

  if (messages.length === 0) {
    throw new ImportError(
      `${filename} produced no readable messages. ` +
        (matchedStartLines === 0 && totalLines > 0
          ? `None of this file's ${totalLines} line(s) matched a recognised WhatsApp timestamp format at ` +
            'all — check this is really an "Export chat" file, not a converted, reformatted, or ' +
            'partially-pasted copy.'
          : 'Export the chat from WhatsApp and upload the file as-is.'),
    );
  }

  const earliest = new Date(Math.min(...messages.map((m) => m.date.getTime())));
  const latest = new Date(Math.max(...messages.map((m) => m.date.getTime())));

  const rangeStartMs = parseISODateUTC(range.start);
  const rangeEndExclusive = parseISODateUTC(range.end) + 24 * 60 * 60 * 1000;
  const withinRange = (d: Date) => d.getTime() >= rangeStartMs && d.getTime() < rangeEndExclusive;

  const rangeMessageEntries = messages.filter((m) => withinRange(m.date));
  const rangeMessages = rangeMessageEntries.map((m) => m.text);
  const messageCount = rangeMessages.length;

  const activityLevel: ActivityLevel =
    previousMessageCount === null || previousMessageCount === 0
      ? 'Medium'
      : messageCount < previousMessageCount * 0.7
        ? 'Low'
        : messageCount > previousMessageCount * 1.3
          ? 'High'
          : 'Medium';

  const topicResult = extractTopics(rangeMessages);
  const { uniqueActiveChatters, topVoices } = extractTopVoices(rangeMessageEntries);

  const figures: WhatsappFigures = {
    messageCount,
    uniqueActiveChatters,
    topVoices,
    activityLevel,
    mainTopics: topicResult.topics,
    topTopicMentions: topicResult.topMentions,
    sentiment: extractSentiment(rangeMessages),
  };

  const periodMessages = rangeMessageEntries
    .filter((m) => !isPlaceholder(m.text))
    .slice(0, 400)
    .map((m) => ({ sender: m.sender, text: m.text.slice(0, 500) }));

  const notes = [
    `${messages.length} message(s) parsed from the full export (${toISODate(earliest)} to ` +
      `${toISODate(latest)}); ${messageCount} of those message(s) fall within the filed period. ` +
      `Dates read as ${dateFormat === 'day-first' ? 'day/month/year' : 'month/day/year'}` +
      (dateFormatConfident
        ? '.'
        : ' (assumed — nothing in this file had an unambiguous date to confirm it).'),
  ];
  if (unrecognizedSystemLines > 0) {
    notes.push(
      `${unrecognizedSystemLines} unrecognised system-message line(s) ignored: ` +
        unrecognizedExamples.map((line) => `"${line}"`).join('; ') +
        (unrecognizedSystemLines > unrecognizedExamples.length ? ', …' : '.'),
    );
  }

  const warnings: string[] = [];

  // A recognition rate this low means the file's own timestamp format
  // probably isn't matching this parser at all, and the few messages above
  // only parsed by coincidence — the figures are likely garbage, not just
  // an incomplete but honest read.
  if (totalLines > 0 && matchedStartLines / totalLines < 0.5) {
    const pctRecognized = Math.round((matchedStartLines / totalLines) * 100);
    warnings.push(
      `Only ${matchedStartLines} of ${totalLines} non-blank line(s) (${pctRecognized}%) were recognised ` +
        `as a WhatsApp message or system line. This export's format may not match what this parser ` +
        `expects, so the figures above are probably incomplete or wrong.` +
        (orphanExamples.length > 0
          ? ` Unrecognised example line(s): ${orphanExamples.map((l) => `"${l}"`).join('; ')}` +
            (orphanLines > orphanExamples.length ? ', …' : '') +
            '.'
          : ''),
    );
  }

  if (!dateFormatConfident) {
    warnings.push(
      `Couldn't confirm this export's date order — every date in it had both day and month ≤12, so it ` +
        `was read as day/month/year by default. If the figures above look wrong, that ambiguity is why.`,
    );
  }

  return { figures, notes, warnings, periodMessages };
}

function parseISODateUTC(iso: string): number {
  return new Date(`${iso}T00:00:00.000Z`).getTime();
}
