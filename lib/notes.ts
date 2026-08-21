/**
 * Persisted import notes carry warnings inline (⚠-prefixed — see the imports
 * API route) so they survive without a fresh upload. This splits them back
 * out for distinct styling.
 *
 * Deliberately a plain module, not exported from a 'use client' component:
 * this needs to run in Server Components (the group page) as well as the
 * client-side import panel, and a function pulled from a 'use client' file
 * becomes an unusable "client reference" when called from server code —
 * Next.js throws at runtime (TypeScript can't catch it) even when the call
 * site is behind a condition that looks like it'd never execute on the
 * server. Keeping the logic here, with no directive, works from either side.
 */
export function splitNotes(notes: string[]): { notes: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const rest: string[] = [];
  for (const note of notes) {
    if (note.startsWith('⚠ ')) warnings.push(note.slice(2));
    else rest.push(note);
  }
  return { notes: rest, warnings };
}
