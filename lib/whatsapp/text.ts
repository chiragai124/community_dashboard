/**
 * Topic and question extraction from chat text.
 *
 * Frequency-based, not a model: there is no network access and no local language
 * model, so this counts terms and phrases with a stopword list and a domain
 * lexicon. That is a real limitation and the UI says so — "the words students
 * used most", not "what the conversation was about". The distinction matters when
 * someone acts on the output.
 */

/** Function words, chat filler, and WhatsApp's own artefacts. */
const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'all', 'also', 'am', 'an', 'and', 'any', 'are',
  'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but',
  'by', 'can', 'cant', 'could', 'couldnt', 'did', 'didnt', 'do', 'does', 'doesnt', 'doing',
  'dont', 'down', 'during', 'each', 'few', 'for', 'from', 'further', 'get', 'got', 'had',
  'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'him', 'his', 'how', 'i', 'if', 'in',
  'into', 'is', 'isnt', 'it', 'its', 'just', 'know', 'like', 'me', 'more', 'most', 'much',
  'my', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'one', 'only', 'or', 'other',
  'our', 'out', 'over', 'own', 'please', 'said', 'same', 'say', 'see', 'she', 'should',
  'so', 'some', 'still', 'such', 'than', 'thanks', 'that', 'thats', 'the', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under',
  'until', 'up', 'us', 'very', 'want', 'was', 'wasnt', 'we', 'well', 'were', 'what', 'when',
  'where', 'which', 'while', 'who', 'why', 'will', 'with', 'would', 'yes', 'yet', 'you',
  'your', 'yours', 'hi', 'hello', 'hey', 'ok', 'okay', 'thank', 'u', 'ur', 'im', 'ive',
  'anyone', 'someone', 'everyone', 'guys', 'sir', 'maam', 'ma', 'pls', 'plz', 'lot',
  'omitted', 'attached', 'media', 'image', 'video', 'audio', 'sticker', 'document', 'gif',
  'message', 'deleted', 'edited', 'https', 'http', 'www', 'com',
]);

/**
 * Terms worth surfacing even at low frequency, because they name a decision a
 * student is trying to make. A domain lexicon is the cheap substitute for
 * understanding: it lets "guarantor" outrank a chattier but less meaningful word.
 */
const DOMAIN_TERMS = new Set([
  'scholarship', 'scholarships', 'visa', 'visas', 'guarantor', 'guarantors', 'deposit',
  'rent', 'accommodation', 'housing', 'flatmate', 'flatmates', 'roommate', 'roommates',
  'ielts', 'toefl', 'gre', 'intake', 'admission', 'admissions', 'offer', 'cas', 'i20',
  'university', 'campus', 'hostel', 'studio', 'ensuite', 'bills', 'utilities', 'contract',
  'tenancy', 'refund', 'refundable', 'installment', 'instalments', 'budget', 'loan',
  'funds', 'bank', 'sim', 'flight', 'insurance', 'biometrics', 'embassy', 'appointment',
  'booking', 'booked', 'moving', 'movein', 'landlord', 'agency', 'commute', 'safety',
]);

const DOMAIN_BOOST = 2.2;

/**
 * Words → normalised tokens. Strips URLs, punctuation, and pure numbers.
 *
 * `minLength` exists because the two callers need different floors. Topic
 * extraction wants 3+, which drops the short function words it would only
 * discard anyway. Sentiment needs 2+: "no" and "so" are a negation and an
 * intensifier, and dropping them silently defeated the negation handling —
 * "no problems at all, great" scored as neutral because the "no" never arrived.
 */
export function tokenize(text: string, minLength = 3): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/'/g, ''))
    .filter((w) => w.length >= minLength && w.length <= 24)
    .filter((w) => !/^\d+$/.test(w));
}

export interface TopicTerm {
  term: string;
  /** Messages the term appeared in — not raw occurrences, so one ranter can't
   *  push a word to the top by repeating it. */
  messages: number;
  /** Ranking score: message count, weighted up for domain terms. */
  score: number;
}

/**
 * The most-used meaningful terms and two-word phrases.
 *
 * Counted per MESSAGE rather than per occurrence: a single person repeating
 * "deposit" thirty times in one message is one message about deposits, and
 * occurrence-counting would let them define the week's topics single-handedly.
 */
export function extractTopics(texts: string[], limit = 10): TopicTerm[] {
  const unigrams = new Map<string, number>();
  const bigrams = new Map<string, number>();

  for (const text of texts) {
    const tokens = tokenize(text);
    const seenUni = new Set<string>();
    const seenBi = new Set<string>();

    for (let i = 0; i < tokens.length; i += 1) {
      const word = tokens[i];
      if (!STOPWORDS.has(word)) seenUni.add(word);

      if (i + 1 < tokens.length) {
        const next = tokens[i + 1];
        // A phrase is only interesting when at least one half carries meaning.
        if (!STOPWORDS.has(word) && !STOPWORDS.has(next)) {
          seenBi.add(`${word} ${next}`);
        }
      }
    }
    for (const term of seenUni) unigrams.set(term, (unigrams.get(term) ?? 0) + 1);
    for (const term of seenBi) bigrams.set(term, (bigrams.get(term) ?? 0) + 1);
  }

  const scored: TopicTerm[] = [];

  // A quiet week has nothing that repeats, so a flat "must appear twice" rule
  // renders no topics at all for exactly the weeks a reader most wants explained.
  // Below ten messages, a single mention of a domain term is the week's signal.
  const sparse = texts.length < 10;

  for (const [term, messages] of unigrams) {
    const isDomain = DOMAIN_TERMS.has(term);
    const floor = sparse && isDomain ? 1 : 2;
    if (messages < floor) continue;
    scored.push({ term, messages, score: messages * (isDomain ? DOMAIN_BOOST : 1) });
  }

  for (const [term, messages] of bigrams) {
    // A phrase needs to recur more than a word to earn its place, since phrases
    // are inherently more specific and thus rarer.
    if (messages < 3) continue;
    const [a, b] = term.split(' ');
    const boost = DOMAIN_TERMS.has(a) || DOMAIN_TERMS.has(b) ? DOMAIN_BOOST : 1;
    // Phrases beat their own component words when they recur, so weight up.
    scored.push({ term, messages, score: messages * boost * 1.35 });
  }

  const ranked = scored.sort((a, b) => b.score - a.score || b.messages - a.messages);

  // Drop a unigram already represented by a higher-ranked phrase: "visa" under
  // "visa appointment" is noise once the phrase is shown.
  const kept: TopicTerm[] = [];
  for (const candidate of ranked) {
    const covered = kept.some(
      (k) => k.term.includes(' ') && k.term.split(' ').includes(candidate.term),
    );
    if (!covered) kept.push(candidate);
    if (kept.length >= limit) break;
  }
  return kept;
}

/* ----------------------------------------------------------------- questions */

/** Collapse to a comparison key, so near-duplicate questions group together. */
function questionKey(text: string): string {
  return tokenize(text)
    .filter((w) => !STOPWORDS.has(w))
    .sort()
    .join(' ');
}

export interface CommonQuestion {
  /** The shortest phrasing seen — usually the clearest. */
  text: string;
  /** How many times a question of this shape was asked. */
  asked: number;
}

/**
 * The questions students actually asked, grouped by near-duplicate.
 *
 * Grouping is by sorted content words, so "is the deposit refundable" and "the
 * deposit — is it refundable?" count as the same question. The shortest phrasing
 * is shown, since the terse version is normally the most readable.
 */
export function extractQuestions(texts: string[], limit = 6): CommonQuestion[] {
  const groups = new Map<string, { text: string; asked: number }>();

  for (const text of texts) {
    const trimmed = text.trim();
    // A question mark is the signal. Long paragraphs that happen to contain one
    // are excluded: they are discussion, not a question worth quoting back.
    if (!trimmed.includes('?')) continue;
    if (trimmed.length > 220 || trimmed.length < 8) continue;

    const key = questionKey(trimmed);
    if (key === '') continue;

    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { text: trimmed, asked: 1 });
    } else {
      existing.asked += 1;
      if (trimmed.length < existing.text.length) existing.text = trimmed;
    }
  }

  return [...groups.values()]
    .sort((a, b) => b.asked - a.asked || a.text.length - b.text.length)
    .slice(0, limit);
}
