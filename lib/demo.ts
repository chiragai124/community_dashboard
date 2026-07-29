import type {
  Ga4SessionRow,
  GroupSlug,
  Registration,
  ShortLinkClicks,
  WeeklyEntry,
} from './types';
import { GROUPS, LEAD_SOURCE_BUCKETS } from './groups';
import { addWeeks, currentWeekStart, lastNWeeks, parseISODate, toISODate } from './weeks';

/**
 * Deterministic demo data.
 *
 * The dashboard is useful the moment it boots, with no Google or Short.io
 * credentials and no weekly entries typed in yet. Everything produced here is
 * flagged as demo in the UI (a "Demo data" pill on every affected surface) and
 * is replaced the instant real credentials or a real entry arrive.
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

/** Per-group starting scale, so the five communities don't look identical. */
const GROUP_PROFILE: Record<GroupSlug, { members: number; growth: number; leads: number }> = {
  uk: { members: 842, growth: 0.041, leads: 34 },
  usa: { members: 1130, growth: 0.052, leads: 41 },
  australia: { members: 468, growth: 0.031, leads: 19 },
  canada: { members: 396, growth: 0.058, leads: 16 },
  germany: { members: 274, growth: 0.024, leads: 11 },
};

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

const NOTE_TEMPLATES = [
  'Strong response after the Instagram story drop on Tuesday.',
  'Quiet week — exam season in most universities.',
  'Scholarship team shared the link twice; noticeable click spike.',
  'Poll got the best engagement so far, mostly ready-to-book students.',
  'Several DMs asked about guarantor requirements — worth a pinned message.',
  'Refer-a-friend push landed well, 3 joins traced to it.',
  'Slower start, picked up after the Thursday property drop.',
];

const FIRST_NAMES = [
  'Aarav', 'Priya', 'Wei', 'Sofia', 'Liam', 'Ananya', 'Noah', 'Mei', 'Omar', 'Elena',
  'Rahul', 'Chloe', 'Yusuf', 'Isabella', 'Arjun', 'Hannah', 'Diego', 'Nour', 'Ethan', 'Zara',
];
const LAST_NAMES = [
  'Sharma', 'Patel', 'Chen', 'Garcia', 'Murphy', 'Rao', 'Smith', 'Wang', 'Hassan', 'Rossi',
  'Kumar', 'Dubois', 'Ali', 'Silva', 'Nguyen', 'Kaur', 'Okafor', 'Weber', 'Novak', 'Costa',
];

const UNIVERSITIES: Record<GroupSlug, string[]> = {
  uk: ['University of Manchester', 'UCL', 'University of Leeds', 'Coventry University'],
  usa: ['Arizona State University', 'NYU', 'Purdue University', 'UT Dallas'],
  australia: ['University of Melbourne', 'Monash University', 'UNSW', 'RMIT'],
  canada: ['University of Toronto', 'UBC', 'York University', 'Concordia University'],
  germany: ['TU Munich', 'RWTH Aachen', 'University of Stuttgart', 'TU Berlin'],
};

/** UTM source/medium pairs matching the four tracked lead sources. */
const SOURCE_UTMS: { source: string; medium: string }[] = [
  { source: 'instagram', medium: 'social' },
  { source: 'refer_a_friend', medium: 'referral' },
  { source: 'scholarship_team', medium: 'partner' },
  { source: 'community_banner', medium: 'banner' },
  { source: 'whatsapp', medium: 'community' },
];

/* ------------------------------------------------------------ weekly entries */

/** Eight weeks of manual entries across all five groups. */
export function demoEntries(endWeek: string = currentWeekStart()): WeeklyEntry[] {
  const weeks = lastNWeeks(DEMO_WEEKS, endWeek);
  const entries: WeeklyEntry[] = [];

  for (const group of GROUPS) {
    const profile = GROUP_PROFILE[group.slug];
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
        notes: rand() > 0.45 ? pick(rand, NOTE_TEMPLATES) : '',
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  return entries;
}

/* --------------------------------------------------------- automated sources */

/** Registration rows as if pulled from the Google Sheet. */
export function demoRegistrations(endWeek: string = currentWeekStart()): Registration[] {
  const weeks = lastNWeeks(DEMO_WEEKS, endWeek);
  const rows: Registration[] = [];

  for (const group of GROUPS) {
    const profile = GROUP_PROFILE[group.slug];
    const rand = rng(hash(`regs:${group.slug}`));

    weeks.forEach((weekStart, weekIndex) => {
      // Leads trend up gently over the window.
      const base = profile.leads * (0.78 + weekIndex * 0.045);
      const count = Math.max(3, Math.round(base * (0.7 + rand() * 0.7)));

      for (let i = 0; i < count; i += 1) {
        const utm = pick(rand, SOURCE_UTMS);
        const dayOffset = randInt(rand, 0, 6);
        const hour = randInt(rand, 7, 22);
        const day = new Date(parseISODate(weekStart).getTime() + dayOffset * 86400000);
        const timestamp = new Date(
          Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, randInt(rand, 0, 59)),
        ).toISOString();
        const first = pick(rand, FIRST_NAMES);
        const last = pick(rand, LAST_NAMES);

        rows.push({
          name: `${first} ${last}`,
          email: `${first.toLowerCase()}.${last.toLowerCase()}${randInt(rand, 10, 99)}@example.com`,
          country: group.sheetCountry[0],
          university: pick(rand, UNIVERSITIES[group.slug]),
          utmSource: utm.source,
          utmMedium: utm.medium,
          utmCampaign: group.utmCampaigns[0],
          timestamp,
        });
      }
    });
  }

  return rows;
}

/** Daily GA4 session rows as if pulled from the Data API. */
export function demoGa4(endWeek: string = currentWeekStart()): Ga4SessionRow[] {
  const weeks = lastNWeeks(DEMO_WEEKS, endWeek);
  const rows: Ga4SessionRow[] = [];

  for (const group of GROUPS) {
    const profile = GROUP_PROFILE[group.slug];
    const rand = rng(hash(`ga4:${group.slug}`));

    weeks.forEach((weekStart, weekIndex) => {
      const weeklyBase = profile.leads * 14 * (0.8 + weekIndex * 0.04);
      for (let day = 0; day < 7; day += 1) {
        const date = toISODate(new Date(parseISODate(weekStart).getTime() + day * 86400000));
        // Weekends dip.
        const dayFactor = day >= 5 ? 0.62 : 1.05;
        const sessions = Math.max(1, Math.round((weeklyBase / 7) * dayFactor * (0.7 + rand() * 0.6)));
        const utm = pick(rand, SOURCE_UTMS);
        rows.push({
          date,
          campaign: group.utmCampaigns[0],
          source: utm.source,
          medium: utm.medium,
          sessions,
        });
      }
    });
  }

  return rows;
}

/** Short.io tracked-link click counts, one link per lead source per group. */
export function demoShortLinks(): ShortLinkClicks[] {
  const links: ShortLinkClicks[] = [];

  for (const group of GROUPS) {
    const profile = GROUP_PROFILE[group.slug];
    const rand = rng(hash(`shortio:${group.slug}`));

    for (const bucket of LEAD_SOURCE_BUCKETS) {
      // Clicks scale with the group's lead volume; conversion lands ~8–22%.
      const leadsFromBucket = profile.leads * DEMO_WEEKS * (0.15 + rand() * 0.3);
      const clicks = Math.round(leadsFromBucket / (0.08 + rand() * 0.14));
      links.push({
        id: `${group.shortioTag}-${bucket.label.toLowerCase().replace(/\s+/g, '-')}`,
        title: `${group.label} — ${bucket.label}`,
        tag: group.shortioTag,
        clicks,
        source: bucket.label,
      });
    }
  }

  return links;
}

/** The week the demo data ends on, used to align default views. */
export function demoEndWeek(): string {
  return currentWeekStart();
}

export { addWeeks };
