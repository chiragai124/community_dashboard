#!/usr/bin/env node
/**
 * Fails if shipped source contains debugging leftovers.
 *
 * This exists because a real one got merged: an `await new Promise(() => {})`
 * injected while diagnosing an unrelated bug reached main and hung the Google
 * Sheets integration on every page render. It typechecked, it built, and the
 * integration's own timeout handling made the symptom look like a slow network
 * rather than an infinite await. Only an explicit check catches that class of
 * mistake, so it runs in CI.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['lib', 'app', 'components', 'scripts'];
const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js'];

/** Each pattern is something that must never appear in committed source. */
const FORBIDDEN = [
  { pattern: /new Promise\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/, why: 'never-resolving promise (hangs forever)' },
  { pattern: /\bEXPERIMENT\b/, why: 'experiment marker' },
  { pattern: /\bdebugger\b/, why: 'debugger statement' },
  { pattern: /\.repeat\(\s*\d{4,}/, why: 'huge synthetic string' },
  { pattern: /TODO[ :]?REMOVE|REMOVE[ :]?BEFORE|DO NOT COMMIT/i, why: 'do-not-commit marker' },
];

/** This file necessarily contains the patterns it searches for. */
const SELF = 'scripts/check-no-debug-stubs.mjs';

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) yield full;
  }
}

const findings = [];
for (const root of ROOTS) {
  let exists = true;
  try {
    statSync(root);
  } catch {
    exists = false;
  }
  if (!exists) continue;

  for (const file of walk(root)) {
    const rel = relative(process.cwd(), file);
    if (rel === SELF) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(line)) {
          findings.push(`${rel}:${i + 1}  ${why}\n    ${line.trim().slice(0, 120)}`);
        }
      }
    });
  }
}

if (findings.length > 0) {
  console.error(`Debug stubs found in committed source (${findings.length}):\n`);
  for (const f of findings) console.error(`  ${f}\n`);
  process.exit(1);
}

console.log('No debug stubs found.');
