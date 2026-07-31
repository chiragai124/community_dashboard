import type { ActivityLevel, GroupSlug, SentimentKey } from '../types';
import { weekStartOf } from '../weeks';
import { parseChatExport, type ParsedChat } from './parse';
import { extractQuestions, extractTopics, type CommonQuestion, type TopicTerm } from './text';
import { analyseSentiment, type SentimentResult } from './sentiment';

/**
 * Turning one chat export into per-week metrics.
 *
 * PRIVACY IS ENFORCED HERE, at the boundary. The parser hands over sender names
 * and full message text because the analysis needs them; nothing in the returned
 * shape carries either, with one deliberate exception:
 *
 *   • Sender names are counted into `activeParticipants` and then dropped. They
 *     are never hashed-and-kept, because a stored hash of a phone number is still
 *     a stable identifier — not keeping anything is stronger than pseudonymising.
 *   • Message text survives ONLY as sentiment example quotes (three per
 *     sentiment, per week), which were explicitly asked for. Everything else is
 *     reduced to counts, terms and percentages.
 *
 * So the transcript itself is never persisted. See lib/whatsapp/store.ts.
 */

export interface WhatsAppWeek {
  weekStart: string;
  /** Messages sent, excluding attachment placeholders. */
  messages: number;
  /** Distinct people who sent at least one message. Identities not retained. */
  activeParticipants: number;

  joinedViaLink: number;
  addedByAdmin: number;
  left: number;
  removed: number;
  /** joins − departures. Always derivable. */
  netChange: number;
  /**
   * Members at the end of the week. Null unless the export reaches the group's
   * creation — without that there is no baseline to count up from, and an
   * invented one would make every growth figure wrong in the same direction.
   */
  members: number | null;

  /** Derived from message volume against this group's own median week. */
  activityLevel: ActivityLevel | null;

  topics: TopicTerm[];
  questions: CommonQuestion[];
  sentiment: SentimentResult;
}

export interface WhatsAppAnalysis {
  group: GroupSlug;
  weeks: WhatsAppWeek[];
  /** True when an absolute member count was derivable. */
  membersKnown: boolean;
  /** Plain-language notes for the import panel, including what was NOT found. */
  notes: string[];
  report: ParsedChat['report'];
}

/** High/Medium/Low from volume against the group's own median week. */
function activityFor(messages: number, median: number): ActivityLevel | null {
  if (median <= 0) return null;
  const ratio = messages / median;
  if (ratio >= 1.25) return 'High';
  if (ratio <= 0.75) return 'Low';
  return 'Medium';
}

export function analyseChatExport(
  buffer: Buffer,
  filename: string,
  group: GroupSlug,
): WhatsAppAnalysis {
  const chat = parseChatExport(buffer, filename);

  // Bucket everything by ISO week.
  const byWeek = new Map<
    string,
    { texts: string[]; senders: Set<string>; messages: number }
  >();
  const eventsByWeek = new Map<
    string,
    { joinedViaLink: number; addedByAdmin: number; left: number; removed: number }
  >();

  const weekOf = (iso: string) => weekStartOf(new Date(iso));

  for (const message of chat.messages) {
    const week = weekOf(message.at);
    let bucket = byWeek.get(week);
    if (!bucket) {
      bucket = { texts: [], senders: new Set(), messages: 0 };
      byWeek.set(week, bucket);
    }
    bucket.senders.add(message.sender);
    // Attachment placeholders are not messages anyone wrote; counting them would
    // inflate volume and pollute topics with the word "omitted".
    if (!message.isAttachment) {
      bucket.messages += 1;
      if (message.text !== '') bucket.texts.push(message.text);
    }
  }

  for (const event of chat.events) {
    const week = weekOf(event.at);
    let bucket = eventsByWeek.get(week);
    if (!bucket) {
      bucket = { joinedViaLink: 0, addedByAdmin: 0, left: 0, removed: 0 };
      eventsByWeek.set(week, bucket);
    }
    if (event.kind === 'joined_via_link') bucket.joinedViaLink += event.count;
    else if (event.kind === 'added') bucket.addedByAdmin += event.count;
    else if (event.kind === 'left') bucket.left += event.count;
    else bucket.removed += event.count;
  }

  const allWeeks = [...new Set([...byWeek.keys(), ...eventsByWeek.keys()])].sort();
  const volumes = allWeeks
    .map((w) => byWeek.get(w)?.messages ?? 0)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const median =
    volumes.length === 0
      ? 0
      : volumes.length % 2 === 1
        ? volumes[(volumes.length - 1) / 2]
        : (volumes[volumes.length / 2 - 1] + volumes[volumes.length / 2]) / 2;

  // An absolute count is only meaningful from a known starting point. The group
  // creator is member one; every join and departure after that is in the export.
  const membersKnown = chat.createdAt !== null;
  let running = membersKnown ? 1 : 0;

  const weeks: WhatsAppWeek[] = allWeeks.map((weekStart) => {
    const bucket = byWeek.get(weekStart);
    const events = eventsByWeek.get(weekStart) ?? {
      joinedViaLink: 0,
      addedByAdmin: 0,
      left: 0,
      removed: 0,
    };
    const netChange =
      events.joinedViaLink + events.addedByAdmin - events.left - events.removed;
    running += netChange;

    const texts = bucket?.texts ?? [];
    return {
      weekStart,
      messages: bucket?.messages ?? 0,
      activeParticipants: bucket?.senders.size ?? 0,
      joinedViaLink: events.joinedViaLink,
      addedByAdmin: events.addedByAdmin,
      left: events.left,
      removed: events.removed,
      netChange,
      members: membersKnown ? Math.max(0, running) : null,
      activityLevel: activityFor(bucket?.messages ?? 0, median),
      topics: extractTopics(texts),
      questions: extractQuestions(texts),
      sentiment: analyseSentiment(texts),
    };
  });

  return {
    group,
    weeks,
    membersKnown,
    notes: buildNotes(chat, membersKnown, weeks),
    report: chat.report,
  };
}

/**
 * What was found and — more importantly — what was not.
 *
 * Every one of these exists because a silent zero is indistinguishable from a
 * metric that cannot be computed, and the whole point of this importer is that
 * the user stops typing and starts trusting it.
 */
function buildNotes(
  chat: ParsedChat,
  membersKnown: boolean,
  weeks: WhatsAppWeek[],
): string[] {
  const notes: string[] = [];
  const r = chat.report;

  notes.push(
    `Read ${r.messageLines.toLocaleString('en-US')} messages and ${r.systemLines.toLocaleString('en-US')} ` +
      `system lines from ${r.fileName}, across ${weeks.length} week(s).`,
  );

  const joins = r.eventCounts.joined_via_link + r.eventCounts.added;
  const departures = r.eventCounts.left + r.eventCounts.removed;
  notes.push(
    `${joins} join(s) (${r.eventCounts.joined_via_link} via invite link, ` +
      `${r.eventCounts.added} added by an admin) and ${departures} departure(s).`,
  );

  if (membersKnown) {
    notes.push(
      'The export reaches this group’s creation, so member counts are absolute.',
    );
  } else {
    notes.push(
      'No group-creation line found, so only NET CHANGE is known — not an absolute ' +
        'member count. Export the full chat history to get absolute figures.',
    );
  }

  if (chat.pollQuestions.length > 0) {
    notes.push(
      `${chat.pollQuestions.length} poll question(s) found, but WhatsApp exports ` +
        'do not include the votes, so poll response rate still comes from the weekly form.',
    );
  }

  if (r.dateOrder === 'unknown') {
    notes.push(
      'Could not tell whether dates are day-first or month-first (no day above 12 ' +
        'in the file); assumed day-first. Weeks may be shifted if that is wrong.',
    );
  }

  if (r.unrecognisedSystemLines > 0) {
    notes.push(
      `${r.unrecognisedSystemLines} system line(s) were not recognised and are not ` +
        `counted${r.samples.length > 0 ? `, e.g. “${r.samples[0]}”` : ''}. Membership ` +
        'matching is English-only.',
    );
  }

  const totalScored = weeks.reduce((sum, w) => sum + w.sentiment.scored, 0);
  const totalSignal = weeks.reduce((sum, w) => sum + w.sentiment.withSignal, 0);
  if (totalScored > 0) {
    const share = Math.round((totalSignal / totalScored) * 100);
    notes.push(
      `Sentiment is keyword-based: ${share}% of messages contained a word or emoji ` +
        'it recognises; the rest counted as neutral.',
    );
  }

  return notes;
}

export type { SentimentKey, SentimentResult, TopicTerm, CommonQuestion };
