import type { SentimentKey } from '../types';
import { tokenize } from './text';

/**
 * Lexicon-based sentiment scoring.
 *
 * BE CLEAR ABOUT WHAT THIS IS. There is no network access and no local language
 * model, so this is a weighted word list with negation and emoji handling — the
 * same family of method as VADER, minus its tuned corpus. It is decent on short,
 * blunt chat messages and poor on sarcasm, mixed sentiment and anything implicit.
 *
 * Consequences, all deliberate:
 *   • A message with no lexicon hit is NEUTRAL, not "unscored". Most chat is
 *     genuinely neutral (logistics, questions), so this is the honest default.
 *   • The thresholds are wide, so a single mild word doesn't tip a message into
 *     positive or negative.
 *   • The UI labels this as keyword-based and reports how many messages carried
 *     any sentiment word at all, so a 90%-neutral week is explainable rather than
 *     looking like a broken metric.
 */

/**
 * Term weights, as two positive-magnitude lists.
 *
 * Split rather than one signed map ON PURPOSE. The first version of this file was
 * a single object with a `// negative` comment above the second half and positive
 * numbers throughout — so every negative word ADDED to the score and sentiment
 * came out inverted: "Very frustrating" scored +4 and landed in positive. The
 * percentages still summed to 100 and the example quotes still rendered, so it
 * looked entirely correct.
 *
 * Keeping the sign structural — applied once, in code, below — means a typo in a
 * word's magnitude can no longer flip its polarity.
 *
 * Magnitudes are coarse: 1 mild, 2 strong.
 */
const POSITIVE_TERMS: Record<string, number> = {
  thanks: 1, thank: 1, thankyou: 2, grateful: 2, appreciate: 2, appreciated: 2,
  perfect: 2, great: 2, excellent: 2, awesome: 2, amazing: 2, brilliant: 2, lovely: 2,
  good: 1, nice: 1, helpful: 2, helped: 1, useful: 1, clear: 1, easy: 1, quick: 1,
  sorted: 2, solved: 2, works: 1, worked: 1, done: 1, booked: 1, approved: 2,
  accepted: 2, congrats: 2, congratulations: 2, happy: 2, glad: 2, relieved: 2,
  excited: 2, love: 2, loved: 2, best: 1, recommend: 2, smooth: 2, fast: 1,
  finally: 1, yay: 2, superb: 2, fantastic: 2, reasonable: 1, affordable: 1,
};

const NEGATIVE_TERMS: Record<string, number> = {
  problem: 1, problems: 1, issue: 1, issues: 1, error: 1, errors: 1, wrong: 1,
  bad: 2, worst: 2, terrible: 2, awful: 2, horrible: 2, poor: 1, useless: 2,
  disappointed: 2, disappointing: 2, frustrated: 2, frustrating: 2, annoyed: 2,
  annoying: 2, angry: 2, upset: 2, worried: 1, worry: 1, anxious: 1, stressed: 2,
  stressful: 2, confused: 1, confusing: 1, unclear: 1, difficult: 1, hard: 1,
  slow: 1, late: 1, delayed: 2, delay: 1, waiting: 1, stuck: 2, ignored: 2,
  rejected: 2, refused: 2, denied: 2, cancelled: 2, scam: 2, misleading: 2,
  overpriced: 2, expensive: 1, unfair: 2, complaint: 2, unresponsive: 2,
  nightmare: 2, mess: 1, failed: 2, fail: 1, lost: 1, missed: 1, hate: 2,
  disgusting: 2, unacceptable: 2, ridiculous: 2, rude: 2,
};

/** The signed lexicon. Negative magnitudes are applied here, once. */
const LEXICON: Record<string, number> = {
  ...POSITIVE_TERMS,
  ...Object.fromEntries(
    Object.entries(NEGATIVE_TERMS).map(([term, weight]) => [term, -weight]),
  ),
};

/** Words that flip the polarity of the next few terms. */
const NEGATIONS = new Set([
  'not', 'no', 'never', 'none', 'cannot', 'cant', 'couldnt', 'didnt', 'doesnt',
  'dont', 'isnt', 'wasnt', 'werent', 'wont', 'wouldnt', 'hardly', 'barely',
  'without', 'nothing', 'nobody',
]);

/** How many tokens after a negation stay flipped. */
const NEGATION_WINDOW = 3;

/** Intensifiers scale the next scored term. */
const INTENSIFIERS: Record<string, number> = {
  very: 1.5, really: 1.5, so: 1.3, extremely: 1.8, incredibly: 1.8, super: 1.4,
  totally: 1.4, absolutely: 1.6, completely: 1.5, quite: 1.2, too: 1.3,
};

const POSITIVE_EMOJI = /[\u{1F600}-\u{1F60F}\u{1F618}\u{1F60D}\u{1F970}\u{1F929}\u{1F973}\u{2764}\u{1F44D}\u{1F64F}\u{1F389}\u{1F38A}\u{2705}\u{1F495}\u{1F496}]/gu;
const NEGATIVE_EMOJI = /[\u{1F61E}-\u{1F62B}\u{1F624}\u{1F620}\u{1F621}\u{1F622}\u{1F62D}\u{1F44E}\u{1F612}\u{1F644}\u{1F915}\u{1F92C}\u{274C}]/gu;

export interface ScoredMessage {
  score: number;
  sentiment: SentimentKey;
  /** True when at least one lexicon term or emoji fired. */
  carriedSignal: boolean;
}

/** Score one message. Positive is positive; the scale is unbounded but coarse. */
export function scoreMessage(text: string): ScoredMessage {
  // minLength 2, so "no" and "so" survive to be read as negation/intensifier.
  const tokens = tokenize(text, 2);
  let score = 0;
  let hits = 0;
  let negatedFor = 0;
  let multiplier = 1;

  for (const token of tokens) {
    if (NEGATIONS.has(token)) {
      negatedFor = NEGATION_WINDOW;
      continue;
    }
    const intensifier = INTENSIFIERS[token];
    if (intensifier !== undefined) {
      multiplier = intensifier;
      continue;
    }

    const weight = LEXICON[token];
    if (weight !== undefined) {
      const signed = negatedFor > 0 ? -weight : weight;
      score += signed * multiplier;
      hits += 1;
      multiplier = 1;
    }
    if (negatedFor > 0) negatedFor -= 1;
  }

  const positiveEmoji = (text.match(POSITIVE_EMOJI) ?? []).length;
  const negativeEmoji = (text.match(NEGATIVE_EMOJI) ?? []).length;
  score += positiveEmoji - negativeEmoji * 1.5;
  hits += positiveEmoji + negativeEmoji;

  // Wide dead zone: one mild word should not colour a whole message.
  const sentiment: SentimentKey = score >= 1.5 ? 'positive' : score <= -1.5 ? 'negative' : 'neutral';
  return { score, sentiment, carriedSignal: hits > 0 };
}

export interface SentimentResult {
  positivePct: number | null;
  neutralPct: number | null;
  negativePct: number | null;
  /** Up to three example messages per sentiment, strongest first. */
  examples: Record<SentimentKey, string[]>;
  /** Messages scored, and how many carried any sentiment word at all. */
  scored: number;
  withSignal: number;
}

/** Readable enough to quote: not a one-word reply, not a wall of text. */
function quotable(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length >= 15 && trimmed.length <= 240 && !/^https?:\/\//i.test(trimmed);
}

/**
 * Sentiment shares over a set of messages, plus the clearest examples of each.
 *
 * Examples are chosen by the strength of their score, filtered to quotable
 * lengths, because the point of an example is to show a reader what the number
 * means. Neutral examples are picked from messages that carried no signal at all
 * — the most representative kind of neutral.
 */
export function analyseSentiment(texts: string[]): SentimentResult {
  const buckets: Record<SentimentKey, { text: string; score: number }[]> = {
    positive: [],
    neutral: [],
    negative: [],
  };
  let scored = 0;
  let withSignal = 0;

  for (const text of texts) {
    const result = scoreMessage(text);
    scored += 1;
    if (result.carriedSignal) withSignal += 1;
    buckets[result.sentiment].push({ text, score: result.score });
  }

  if (scored === 0) {
    return {
      positivePct: null,
      neutralPct: null,
      negativePct: null,
      examples: { positive: [], neutral: [], negative: [] },
      scored: 0,
      withSignal: 0,
    };
  }

  const pct = (n: number) => Math.round((n / scored) * 1000) / 10;

  const pick = (key: SentimentKey): string[] => {
    const candidates = buckets[key].filter((m) => quotable(m.text));
    const ordered =
      key === 'negative'
        ? candidates.sort((a, b) => a.score - b.score)
        : key === 'positive'
          ? candidates.sort((a, b) => b.score - a.score)
          : // Neutral: prefer the middle of the length range, which reads as a
            // typical message rather than a fragment.
            candidates.sort((a, b) => Math.abs(a.text.length - 90) - Math.abs(b.text.length - 90));

    const seen = new Set<string>();
    const out: string[] = [];
    for (const candidate of ordered) {
      const key2 = candidate.text.trim().toLowerCase();
      if (seen.has(key2)) continue;
      seen.add(key2);
      out.push(candidate.text.trim());
      if (out.length === 3) break;
    }
    return out;
  };

  return {
    positivePct: pct(buckets.positive.length),
    neutralPct: pct(buckets.neutral.length),
    negativePct: pct(buckets.negative.length),
    examples: {
      positive: pick('positive'),
      neutral: pick('neutral'),
      negative: pick('negative'),
    },
    scored,
    withSignal,
  };
}
