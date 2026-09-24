import type { GroupConfig, GroupSlug } from '../types';

/**
 * Working out which group a WhatsApp export belongs to, from the export
 * itself.
 *
 * Uploading five files and then tagging each one with a dropdown is five
 * chances to mis-file a country, and the information is already in the file:
 * the chat's own group name. So the name is read — from the uploaded
 * filename, from the transcript's `.txt` entry name inside the archive, and
 * from the "created group"/"changed the subject to" lines in the transcript
 * itself — and matched against the destination each group tracks.
 *
 * Matching is scoped to ONE community's groups, because the upload area is
 * per community. That removes the hardest part of the problem: a chat called
 * "amber global aspirants UK" only has to be told apart from Australia,
 * Canada, Germany and the USA, never from another community's UK group.
 *
 * Every match is reported with the evidence that produced it, so a wrong
 * guess is visible and correctable rather than silent.
 */

/**
 * Aliases per destination, matched as whole words.
 *
 * Whole words matter more than it looks. "us" appears inside "aspirants",
 * "august" and "campus"; "can" inside "cancelled" and, more to the point,
 * inside any sentence at all. Substring matching would file half the uploads
 * under the USA.
 */
const DESTINATION_ALIASES: Record<string, string[]> = {
  'United Kingdom': [
    'united kingdom',
    'great britain',
    'uk',
    'u k',
    'gb',
    'britain',
    'british',
    'england',
    'london',
  ],
  'United States': [
    'united states',
    'united states of america',
    'usa',
    'u s a',
    'us',
    'u s',
    'america',
    'american',
    'states',
  ],
  Australia: ['australia', 'australian', 'aus', 'aussie', 'oz', 'sydney', 'melbourne'],
  Canada: ['canada', 'canadian', 'toronto', 'vancouver'],
  Germany: ['germany', 'german', 'deutschland', 'berlin', 'munich'],
};

/** Where a candidate name came from, for the "detected from…" line in the UI. */
export type DetectionEvidence = 'filename' | 'archive entry' | 'chat group name';

export interface GroupCandidate {
  text: string;
  evidence: DetectionEvidence;
}

export interface GroupDetection {
  group: GroupSlug | null;
  /** The destination that matched, e.g. "Australia". Null when nothing did. */
  destination: string | null;
  evidence: DetectionEvidence | null;
  /** The text the match was made from, for display. */
  matchedText: string | null;
  /** Every alias that hit, strongest first — for explaining an unexpected match. */
  matchedAliases: string[];
}

/** Lowercase, punctuation to spaces, runs of whitespace collapsed. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\.(zip|txt)$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Does `haystack` contain `alias` as a whole word (or whole multi-word phrase)? */
function containsWord(haystack: string, alias: string): boolean {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^| )${escaped}(?: |$)`).test(haystack);
}

/** Which of a destination's aliases appear in `normalized`, longest first. */
function scoreDestination(normalized: string, destination: string): { hits: string[] } {
  const aliases = DESTINATION_ALIASES[destination] ?? [];
  return {
    hits: aliases
      .filter((alias) => containsWord(normalized, alias))
      .sort((a, b) => b.length - a.length),
  };
}

/**
 * The group names WhatsApp stamps into a transcript, in the order they appear.
 *
 * Both the creation line and every later subject change are read. Document
 * order is what makes a renamed group resolve to the name it has *now*: the
 * patterns are scanned separately but the hits are re-sorted by position, so
 * "created UK" followed by "renamed to Canada" ends up Canada-last rather
 * than grouped by which regex found it.
 */
export function groupNamesInTranscript(text: string): string[] {
  // Only the first stretch of the file is scanned: the creation line is at the
  // top, and reading a whole multi-megabyte export for a name that appears in
  // its first few hundred lines is wasted work on every upload.
  const head = text.slice(0, 200_000);
  const patterns = [
    /created (?:this )?group ["“”']([^"“”'\n]{2,80})["“”']/gi,
    /changed the subject (?:from ["“”'][^"“”'\n]*["“”'] )?to ["“”']([^"“”'\n]{2,80})["“”']/gi,
  ];

  const found: { at: number; name: string }[] = [];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(head)) !== null) {
      const name = match[1].trim();
      if (name !== '') found.push({ at: match.index, name });
    }
  }

  return found.sort((a, b) => a.at - b.at).map((f) => f.name);
}

/**
 * Candidate names for an export, strongest evidence first.
 *
 * The chat's own group name comes first where it exists: it is what the group
 * is actually called, whereas a filename can be renamed to anything on the
 * way to the upload. The archive's inner `.txt` entry ("WhatsApp Chat with
 * …") comes next, then the uploaded filename.
 */
export function detectionCandidates({
  uploadedFilename,
  archiveEntryName,
  transcript,
}: {
  uploadedFilename: string;
  archiveEntryName?: string | null;
  transcript?: string | null;
}): GroupCandidate[] {
  const candidates: GroupCandidate[] = [];

  if (transcript) {
    const names = groupNamesInTranscript(transcript);
    // Last first: the most recent subject change is the current name.
    for (const name of [...names].reverse()) {
      candidates.push({ text: name, evidence: 'chat group name' });
    }
  }
  if (archiveEntryName) candidates.push({ text: archiveEntryName, evidence: 'archive entry' });
  candidates.push({ text: uploadedFilename, evidence: 'filename' });

  return candidates;
}

/**
 * Match an export to one of `groups`, which must all belong to the community
 * being uploaded into.
 *
 * Candidates are tried in order and the first one that names exactly one
 * destination wins. A candidate naming two — "UK vs USA comparison" — is
 * ambiguous and is skipped rather than guessed at, so the next candidate gets
 * its turn. Ambiguity is judged by how many destinations appear at all, not
 * by which alias was longest: "USA" being a longer string than "UK" says
 * nothing about which group the file is for, and letting length break that
 * tie would file the export under a country the name merely mentions.
 */
export function detectGroup(
  candidates: GroupCandidate[],
  groups: GroupConfig[],
): GroupDetection {
  const miss: GroupDetection = {
    group: null,
    destination: null,
    evidence: null,
    matchedText: null,
    matchedAliases: [],
  };

  for (const candidate of candidates) {
    const normalized = normalize(candidate.text);
    if (normalized === '') continue;

    const scored = groups
      .map((group) => ({ group, ...scoreDestination(normalized, group.name) }))
      .filter((s) => s.hits.length > 0);

    // Nothing here, or more than one destination named — either way this
    // candidate can't settle it on its own.
    if (scored.length !== 1) continue;

    return {
      group: scored[0].group.slug,
      destination: scored[0].group.name,
      evidence: candidate.evidence,
      matchedText: candidate.text,
      matchedAliases: scored[0].hits,
    };
  }

  return miss;
}
