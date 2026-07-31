import type { WeeklyEntry } from './types';
import { GROUPS } from './groups';
import { addWeeks, currentWeekStart, lastNWeeks, parseISODate } from './weeks';

/**
 * Deterministic demo weekly entries.
 *
 * The dashboard is legible the moment it boots, before any week has been typed
 * in. Everything produced here is flagged as demo in the UI and is replaced by
 * the first real save. It is never written to disk — see lib/store.ts.
 *
 * Imported figures (Short.io clicks, GA4 users and sessions) have NO demo
 * equivalent on purpose: an invented traffic number that later turns out to have
 * been fabricated costs more trust than an empty card does patience. Those cards
 * stay empty until a real file is uploaded.
 *
 * Everything is driven off each group's `demo` profile in lib/groups.ts, so a
 * new group or community gets demo data automatically.
 *
 * There is no Math.random() anywhere: a small seeded PRNG keeps numbers stable
 * across renders and server restarts, so charts don't twitch between reloads.
 */

const DEMO_WEEKS = 8;

/** Mulberry32 — small, fast, stable. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function randInt(rand: () => number, min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function pick<T>(rand: () => number, items: T[]): T {
  return items[Math.floor(rand() * items.length)];
}

/** `count` distinct items, so a topic list never repeats a tag. */
function pickSome<T>(rand: () => number, items: T[], count: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }
  return out;
}

const POLL_TEMPLATES: { question: string; options: string[] }[] = [
  {
    question: 'What stage of your housing search are you at?',
    options: ['Just researching', 'Shortlisting', 'Ready to book', 'Already booked'],
  },
  {
    question: 'Biggest worry about moving abroad?',
    options: ['Budget', 'Finding housemates', 'Visa paperwork', 'Distance to campus'],
  },
  {
    question: 'What would help you most right now?',
    options: ['Property shortlists', '1:1 guidance', 'Scholarship info', 'Cost breakdowns'],
  },
  {
    question: 'When do you move in?',
    options: ['Within a month', '1–3 months', '3–6 months', 'Next year'],
  },
  {
    question: 'How did you hear about this community?',
    options: ['Instagram', 'A friend', 'Scholarship team', 'amber website'],
  },
];

/** Topic tags, questions and content reactions for the qualitative fields. */
const TOPIC_POOL = [
  'Scholarships',
  'Visa process',
  'IELTS',
  'Accommodation costs',
  'Guarantor requirements',
  'Flatmate matching',
  'Bank account setup',
  'Part-time work rules',
  'Move-in dates',
  'City safety',
];

const QUESTION_POOL = [
  'Do I need a UK guarantor to book?',
  'How early should I book for September?',
  'Can I pay rent in instalments?',
  'Is the deposit refundable if my visa is refused?',
  'What counts as proof of funds?',
  'How far is this from campus by bus?',
  'Can I share a twin studio with a friend?',
  'Are bills included in the rent?',
  'What happens if my course start date moves?',
  'Do you have anything under £200 a week?',
];

const CONTENT_RESPONSE_TEMPLATES = [
  'Poll got the most replies of any post; the property carousel was mostly skimmed.',
  'Announcement about the scholarship deadline drove the week’s DM spike.',
  'Video tour got saved a lot but few replies — reactions over comments.',
  'Text-only checklist outperformed the graphic version; several asked for a PDF.',
  'Quiet on announcements, but the cost-breakdown post got quoted repeatedly.',
  'Reels landed better than static images; two students shared with friends.',
];

const ACTIVITY_NOTE_TEMPLATES = [
  'Steady chat all week, spike around the Tuesday poll.',
  'Exam season — replies dropped off after Wednesday.',
  'Busiest week yet, mostly move-in logistics.',
  'Slow start, picked up sharply after the deadline reminder.',
  'A handful of very active members carried most of the thread.',
  'Quiet but high-intent: fewer messages, more booking questions.',
];

const NOTE_TEMPLATES = [
  'Strong response after the Instagram story drop on Tuesday.',
  'Quiet week — exam season in most universities.',
  'Scholarship team shared the link twice; noticeable click spike.',
  'Poll got the best engagement so far, mostly ready-to-book students.',
  'Several DMs asked about guarantor requirements — worth a pinned message.',
  'Refer-a-friend push landed well, 3 joins traced to it.',
  'Slower start, picked up after the Thursday property drop.',
];

/** UTM source/medium pairs matching the four tracked lead sources. */
/* ------------------------------------------------------------ weekly entries */

/** Eight weeks of manual entries across every group in every community. */
export function demoEntries(endWeek: string = currentWeekStart()): WeeklyEntry[] {
  const weeks = lastNWeeks(DEMO_WEEKS, endWeek);
  const entries: WeeklyEntry[] = [];

  for (const group of GROUPS) {
    const profile = group.demo;
    const rand = rng(hash(`entries:${group.slug}`));
    let members = profile.members;

    weeks.forEach((weekStart, index) => {
      // Growth wobbles around the group's baseline rate.
      const rate = profile.growth * (0.55 + rand() * 0.95);
      const added = Math.max(2, Math.round(members * rate));
      members += added;

      const pollTemplate = POLL_TEMPLATES[(index + hash(group.slug)) % POLL_TEMPLATES.length];
      // Response rate lands roughly 6–14% of members.
      const responseTotal = Math.round(members * (0.06 + rand() * 0.08));
      const weights = pollTemplate.options.map(() => 0.5 + rand());
      const weightSum = weights.reduce((s, w) => s + w, 0);
      const options = pollTemplate.options.map((label, i) => ({
        label,
        count: Math.max(1, Math.round((weights[i] / weightSum) * responseTotal)),
      }));

      // A second poll in some weeks, so the history table isn't uniform.
      const polls = [{ question: pollTemplate.question, options }];
      if (rand() > 0.68) {
        const second = POLL_TEMPLATES[(index + 3 + hash(group.slug)) % POLL_TEMPLATES.length];
        const secondTotal = Math.round(responseTotal * (0.4 + rand() * 0.4));
        const w2 = second.options.map(() => 0.5 + rand());
        const s2 = w2.reduce((s, w) => s + w, 0);
        polls.push({
          question: second.question,
          options: second.options.map((label, i) => ({
            label,
            count: Math.max(1, Math.round((w2[i] / s2) * secondTotal)),
          })),
        });
      }

      const dmsSent = randInt(rand, 18, 62);
      const dmReplies = Math.round(dmsSent * (0.28 + rand() * 0.34));

      const activityScore = rate / profile.growth;
      const activityLevel =
        activityScore > 1.25 ? 'High' : activityScore > 0.85 ? 'Medium' : 'Low';

      // 2–3 topics and 2–3 questions per week, drawn without repeats.
      const mainTopics = pickSome(rand, TOPIC_POOL, randInt(rand, 2, 3));
      const commonQuestions = pickSome(rand, QUESTION_POOL, randInt(rand, 2, 3));

      const now = parseISODate(weekStart).toISOString();
      entries.push({
        id: `${group.slug}:${weekStart}`,
        group: group.slug,
        weekStart,
        totalMembers: members,
        newMembersOverride: null,
        polls,
        dmsSent,
        dmReplies,
        activityLevel,
        activityNote: pick(rand, ACTIVITY_NOTE_TEMPLATES),
        mainTopics,
        commonQuestions,
        contentResponse: rand() > 0.25 ? pick(rand, CONTENT_RESPONSE_TEMPLATES) : '',
        notes: rand() > 0.45 ? pick(rand, NOTE_TEMPLATES) : '',
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  return entries;
}

export { addWeeks };
