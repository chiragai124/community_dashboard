import type { ActivityLevel, Voice } from '../types';

/**
 * The one external API call this app makes: Groq's free-tier chat completions
 * endpoint, used to turn a group's real weekly chat text into a short status
 * tag, a one-line gloss on who's driving the conversation, and a narrative
 * paragraph on what people are actually talking about.
 *
 * This is a deliberate, user-approved exception to the rest of the app's
 * "nothing leaves this machine" design: real message text and sender names
 * are sent to Groq's API for this one call. Nothing else in the app makes a
 * network call, and the messages themselves are never persisted anywhere —
 * they exist only for the duration of the request that generated the summary.
 *
 * Called only for the MOST RECENT week of a WhatsApp upload (not every
 * backfilled week), to stay well inside the free tier's daily request cap —
 * see the module doc in app/api/imports/route.ts.
 *
 * If GROQ_API_KEY isn't set, or the call fails for any reason, every function
 * here returns null rather than throwing — the rest of the dashboard is fully
 * usable without it, just missing the AI-written fields.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Picked from Groq's currently-served model list (checked live against
// /openai/v1/models — Groq deprecates and rotates models over time, so this
// may need revisiting): a smaller open-weight model for a more generous
// free-tier rate limit than the larger 120b variant, with JSON-mode support.
const MODEL = 'openai/gpt-oss-20b';

export function groqEnabled(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

async function callGroq(
  systemPrompt: string,
  userPrompt: string,
): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.4,
        // Generous enough that the multi-group community/overview syntheses
        // (several paragraphs' worth of input, an array-shaped response)
        // don't get cut off mid-JSON — a truncated response fails to parse
        // outright, which is worse than a slightly larger token budget.
        max_tokens: 2000,
      }),
    });

    if (!res.ok) {
      console.error(`Groq call failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
      return null;
    }

    const payload = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;
    return JSON.parse(content) as Record<string, unknown>;
  } catch (err) {
    console.error('Groq call errored:', err);
    return null;
  }
}

/* ------------------------------------------------------- per-group summary */

export interface GroupSummaryInput {
  groupLabel: string;
  communityLabel: string;
  messages: { sender: string; text: string }[];
  topVoices: Voice[];
  messageCount: number;
  uniqueActiveChatters: number;
  activityLevel: ActivityLevel;
  mainTopics: string[];
}

export interface GroupSummaryResult {
  statusTag: string;
  topVoicesSummary: string;
  narrative: string;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

export async function generateGroupSummary(
  input: GroupSummaryInput,
): Promise<GroupSummaryResult | null> {
  if (input.messages.length === 0) return null;

  // Capped further here (on top of the 400-message cap already applied by
  // the parser) to keep the prompt small and fast — a few hundred lines is
  // plenty of signal for a one-paragraph summary.
  const transcript = input.messages
    .slice(0, 250)
    .map((m) => `${m.sender}: ${m.text.replace(/\n/g, ' ')}`)
    .join('\n');

  const systemPrompt =
    'You summarise one week of a WhatsApp community group chat for a weekly report. ' +
    'Respond with ONLY a JSON object: {"statusTag": string, "topVoicesSummary": string, ' +
    '"narrative": string}. ' +
    'statusTag is 1-3 words describing this week\'s activity, e.g. "Most Active", "On-topic", ' +
    '"Silent", "Low", "Steady", "Turnaround" — pick whatever best fits, grounded in the message ' +
    'volume and content given. ' +
    'topVoicesSummary is one short sentence naming the top contributors and characterising the ' +
    'spread (e.g. "broad spread, no single dominant voice" or "carried by two or three regulars"). ' +
    'narrative is 1-2 short paragraphs, in plain prose, on what people are actually talking about ' +
    'this week — reference specific topics or situations raised in the chat (without inventing ' +
    'anything not in the messages). Do not use markdown formatting.';

  const userPrompt =
    `Group: ${input.groupLabel} (${input.communityLabel})\n` +
    `Messages this week: ${input.messageCount}. Unique active chatters: ${input.uniqueActiveChatters}. ` +
    `Activity level (vs this group's own trailing average): ${input.activityLevel}.\n` +
    `Top voices by message count: ${input.topVoices.map((v) => `${v.name} (${v.count})`).join(', ') || 'none'}.\n` +
    `Locally-detected keyword topics: ${input.mainTopics.join(', ') || 'none'}.\n\n` +
    `Transcript (sender: message), oldest first:\n${transcript}`;

  const result = await callGroq(systemPrompt, userPrompt);
  if (!result) return null;

  return {
    statusTag: str(result.statusTag, input.activityLevel),
    topVoicesSummary: str(result.topVoicesSummary, ''),
    narrative: str(result.narrative, ''),
  };
}

/* ------------------------------------------------------ community synthesis */

export interface GroupForCommunitySummary {
  groupLabel: string;
  statusTag: string;
  messageCount: number;
  mainTopics: string[];
  /** This group's own AI narrative, if one was generated at upload time. */
  narrative: string;
}

export interface CommunitySummaryResult {
  mainTopics: string[];
  narrative: string;
}

/**
 * One "Main Topics Discussed" pill list and one narrative paragraph for a
 * whole community, synthesised across its groups' already-generated
 * per-group summaries and locally-detected topics — no raw chat text is
 * sent for this call. Triggered manually (a "Regenerate" action on the
 * Community tab), not automatically per upload, since a community's report
 * only fully settles once all five of its groups have been filed for the
 * current period.
 */
export async function generateCommunitySummary(
  communityLabel: string,
  groups: GroupForCommunitySummary[],
): Promise<CommunitySummaryResult | null> {
  const withSignal = groups.filter((g) => g.narrative || g.mainTopics.length > 0);
  if (withSignal.length === 0) return null;

  const systemPrompt =
    'You synthesise one community\'s weekly report from its groups\' already-written summaries. ' +
    'Respond with ONLY a JSON object: {"mainTopics": string[], "narrative": string}. ' +
    'mainTopics is 4-8 short phrases (3-8 words each) naming the specific, concrete subjects ' +
    'raised across these groups this period — not single generic words. narrative is 1-2 short ' +
    'paragraphs of plain prose on what this community is actually talking about, calling out ' +
    'specific groups and themes worth highlighting. Do not invent facts not present in the input, ' +
    'and do not use markdown formatting.';

  const userPrompt =
    `Community: ${communityLabel}\n\n` +
    groups
      .map(
        (g) =>
          `${g.groupLabel} — ${g.messageCount} messages, status "${g.statusTag}".\n` +
          `  Locally-detected topics: ${g.mainTopics.join(', ') || 'none'}.\n` +
          (g.narrative ? `  Narrative: ${g.narrative}` : '  Narrative: (none generated)'),
      )
      .join('\n\n');

  const result = await callGroq(systemPrompt, userPrompt);
  if (!result) return null;

  const mainTopics = Array.isArray(result.mainTopics)
    ? (result.mainTopics as unknown[]).map((t) => str(t, '')).filter((t) => t !== '').slice(0, 8)
    : [];
  const narrative = str(result.narrative, '');
  if (mainTopics.length === 0 && narrative === '') return null;

  return { mainTopics, narrative };
}

/* --------------------------------------------------------- overview takeaways */

export interface CommunitySummaryInput {
  communityLabel: string;
  memberCount: number;
  messageCount: number;
  groupSummaries: { groupLabel: string; statusTag: string; narrative: string }[];
}

export interface Takeaway {
  tag: string;
  text: string;
  /** Maps to the reference's .callout / .callout.good styling. */
  tone: 'good' | 'neutral';
}

/**
 * Cross-community "Headline Takeaways" for the Overview page. Built from the
 * already-generated per-group summaries rather than raw chat text — no
 * additional message content is sent to Groq for this call.
 */
export async function generateOverviewTakeaways(
  communities: CommunitySummaryInput[],
): Promise<Takeaway[] | null> {
  const hasAnySummary = communities.some((c) => c.groupSummaries.length > 0);
  if (!hasAnySummary) return null;

  const systemPrompt =
    'You write short "Headline Takeaways" callouts for a cross-community weekly engagement ' +
    'report, based on per-group summaries already written for this week. Respond with ONLY a ' +
    'JSON object: {"takeaways": [{"tag": string, "text": string, "tone": "good"|"neutral"}]}. ' +
    'Produce 2-4 takeaways. tag is a short label (1-3 words) like "Turnaround", "On-topic", ' +
    '"New & small". text is one or two sentences, calling out something concrete — a turnaround, ' +
    'a notably on-topic or quiet group, a new/small community worth flagging. tone is "good" only ' +
    'when the takeaway is a positive signal. Do not invent facts not present in the input.';

  const userPrompt = communities
    .map(
      (c) =>
        `${c.communityLabel} — ${c.memberCount} members, ${c.messageCount} messages this week.\n` +
        c.groupSummaries
          .map((g) => `  · ${g.groupLabel}: [${g.statusTag}] ${g.narrative}`)
          .join('\n'),
    )
    .join('\n\n');

  const result = await callGroq(systemPrompt, userPrompt);
  if (!result || !Array.isArray(result.takeaways)) return null;

  return (result.takeaways as unknown[])
    .map((raw) => {
      const t = raw as Record<string, unknown>;
      const tone = t.tone === 'good' ? 'good' : 'neutral';
      return { tag: str(t.tag, ''), text: str(t.text, ''), tone: tone as 'good' | 'neutral' };
    })
    .filter((t) => t.tag !== '' && t.text !== '')
    .slice(0, 4);
}
