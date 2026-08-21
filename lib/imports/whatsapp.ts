import type { ActivityLevel, SentimentBreakdown, Voice, WhatsappFigures } from '../types';
import { emptySentiment } from '../types';
import { toISODate } from '../weeks';
import { listZipEntries, readZipEntryData } from '../zip';
import { ImportError } from './shortio';

/**
 * Turning a WhatsApp export into figures for one manually-entered date range.
 *
 * The export is expected to be the group's FULL history, re-downloaded (and
 * re-parsed from scratch) each time it's uploaded — not a slice matching the
 * filed period. That is what makes `totalMembers` derivable at all: a chat
 * export has no "member count" field anywhere in it, only join/add/leave/
 * remove system messages, so the only way to know how many members a group
 * has is to replay every one of those events from the group's creation
 * through the end of the filed period. A partial export would give a
 * partial (and silently wrong) replay.
 *
 * Topics, sentiment, active-chatter counts and activity level are NOT
 * replayed from the start — those describe the filed period's own
 * conversation, so they're computed only from messages inside it, regardless
 * of how much history the export actually contains around them.
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

interface RawEvent {
  date: Date;
  kind: 'join' | 'leave';
  method: 'link' | 'added';
}

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
 * Known join/leave system-message shapes, tried in order.
 *
 * Joins and leaves are NOT symmetric by accident: WhatsApp shows both an
 * active form ("Bob added Alice", "Bob removed Alice") and a passive one
 * where the actor isn't named ("Alice was added", "Alice was removed" — this
 * happens e.g. when the actor's own account is no longer resolvable). A
 * missing passive-leave pattern here previously meant some real departures
 * were silently uncounted, which overcounts current membership by exactly
 * that many people — the passive forms for both directions are required for
 * the replay to balance.
 */
const EVENT_PATTERNS: {
  re: RegExp;
  build: (m: RegExpMatchArray) => Omit<RawEvent, 'date'>;
}[] = [
  { re: /^.+? joined using this group'?s invite link$/i, build: () => ({ kind: 'join', method: 'link' }) },
  { re: /^.+? joined from the community$/i, build: () => ({ kind: 'join', method: 'link' }) },
  { re: /^.+? was added$/i, build: () => ({ kind: 'join', method: 'added' }) },
  { re: /^.+? added .+$/i, build: () => ({ kind: 'join', method: 'added' }) },
  { re: /^.+? was removed$/i, build: () => ({ kind: 'leave', method: 'added' }) },
  { re: /^.+? removed .+$/i, build: () => ({ kind: 'leave', method: 'added' }) },
  { re: /^.+? left( the group)?$/i, build: () => ({ kind: 'leave', method: 'added' }) },
];

/**
 * Other system lines: recognised so they don't get mis-parsed as messages or
 * as a join/leave, but not counted as anything.
 *
 * Checked BEFORE `EVENT_PATTERNS`, which matters for admin promotions and
 * demotions: "Bob removed Alice as admin" and "Bob added Alice as admin" are
 * NOT departures or joins — they only change admin status — but they'd
 * otherwise match the generic "removed"/"added" event patterns above and get
 * miscounted as a real leave/join. Matching the admin wording here first
 * routes them to "ignored" instead.
 */
const IGNORED_SYSTEM_RE =
  /(end-to-end encrypted|created (this )?group|changed the (subject|group description|icon)|changed this group'?s icon|changed their phone number|security code (with|changed)|(removed|added) .+ as (an )?admin|now an admin|is an admin|no longer an admin|disappearing messages|message was deleted|deleted this message|pinned a message|changed the group settings|turned off admin approval|turned on admin approval|reset (this|the) group'?s invite link|group settings changed)/i;

export interface ParsedWhatsapp {
  events: RawEvent[];
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
 * Parse the raw export into a flat, chronological list of events and
 * messages. A line with no timestamp prefix continues the previous message
 * (WhatsApp wraps a multi-line message this way).
 */
export function parseWhatsappExport(text: string): ParsedWhatsapp {
  const { format, confident } = inferDateFormat(text);

  const events: RawEvent[] = [];
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

    // Checked before EVENT_PATTERNS — see IGNORED_SYSTEM_RE's doc comment.
    if (IGNORED_SYSTEM_RE.test(rest)) continue;

    const eventMatch = EVENT_PATTERNS.find((p) => p.re.test(rest));
    if (eventMatch) {
      const m = eventMatch.re.exec(rest);
      if (m) events.push({ date, ...eventMatch.build(m) });
      continue;
    }

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
    events,
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
    events,
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

  if (events.length === 0 && messages.length === 0) {
    throw new ImportError(
      `${filename} produced no readable messages or join/leave events. ` +
        (matchedStartLines === 0 && totalLines > 0
          ? `None of this file's ${totalLines} line(s) matched a recognised WhatsApp timestamp format at ` +
            'all — check this is really an "Export chat" file, not a converted, reformatted, or ' +
            'partially-pasted copy.'
          : 'Export the chat from WhatsApp and upload the file as-is.'),
    );
  }

  const allDates = [...events.map((e) => e.date), ...messages.map((m) => m.date)];
  const earliest = new Date(Math.min(...allDates.map((d) => d.getTime())));
  const latest = new Date(Math.max(...allDates.map((d) => d.getTime())));

  // Replay every event up through the end of range.end — the running total
  // as of that moment is this period's member count.
  const rangeEndExclusive = parseISODateUTC(range.end) + 24 * 60 * 60 * 1000;
  const sortedEvents = [...events].sort((a, b) => a.date.getTime() - b.date.getTime());
  let totalMembers = 0;
  for (const event of sortedEvents) {
    if (event.date.getTime() >= rangeEndExclusive) break;
    totalMembers += event.kind === 'join' ? 1 : -1;
  }
  totalMembers = Math.max(0, totalMembers);

  const rangeStartMs = parseISODateUTC(range.start);
  const withinRange = (d: Date) => d.getTime() >= rangeStartMs && d.getTime() < rangeEndExclusive;

  const rangeEvents = events.filter((e) => withinRange(e.date));
  const joinsViaLink = rangeEvents.filter((e) => e.kind === 'join' && e.method === 'link').length;
  const joinsAdded = rangeEvents.filter((e) => e.kind === 'join' && e.method === 'added').length;
  const leaves = rangeEvents.filter((e) => e.kind === 'leave').length;

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
    totalMembers,
    newMembers: joinsViaLink + joinsAdded - leaves,
    joinsViaLink,
    joinsAdded,
    leaves,
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

  const totalJoins = events.filter((e) => e.kind === 'join').length;
  const totalLeaves = events.filter((e) => e.kind === 'leave').length;
  const notes = [
    `${totalJoins} join(s), ${totalLeaves} leave(s), ${messages.length} message(s) parsed from the ` +
      `full export (${toISODate(earliest)} to ${toISODate(latest)}); ${messageCount} of those ` +
      `message(s) fall within the filed period. Dates read as ` +
      `${dateFormat === 'day-first' ? 'day/month/year' : 'month/day/year'}` +
      (dateFormatConfident
        ? '.'
        : ' (assumed — nothing in this file had an unambiguous date to confirm it).'),
  ];
  if (unrecognizedSystemLines > 0) {
    // If any of these are actually a join or leave phrased in a way this
    // parser doesn't recognise yet, membership will be off by that many —
    // shown verbatim (not just a count) so a mismatch is diagnosable without
    // re-reading the whole export.
    notes.push(
      `${unrecognizedSystemLines} unrecognised system-message line(s) ignored — if member ` +
        `count looks off, check whether any of these are really a join or leave: ` +
        unrecognizedExamples.map((line) => `"${line}"`).join('; ') +
        (unrecognizedSystemLines > unrecognizedExamples.length ? ', …' : '.'),
    );
  }

  const warnings: string[] = [];

  // A recognition rate this low means the file's own timestamp format
  // probably isn't matching this parser at all, and the few events/messages
  // above only parsed by coincidence — the figures are likely garbage, not
  // just an incomplete but honest read.
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
