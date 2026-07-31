import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { GroupSlug, Lead, LeadBreakdownRow, LeadInput } from './types';
import { isGroupSlug } from './groups';
import { parseISODate, weekStartOf } from './weeks';

/**
 * Storage and breakdowns for hand-entered leads.
 *
 * PERSONAL DATA lives here — names, emails, phone numbers. Three consequences,
 * all deliberate:
 *
 *  • Leads are written to data/leads.json only. That path is gitignored, so a
 *    lead can never reach the repository by accident.
 *  • Nothing in this file transmits anything. There is no export endpoint and no
 *    outbound request; the data is readable only by whoever can read the disk.
 *  • There is NO demo mode. Fabricated names and email addresses would be
 *    indistinguishable from real ones once saved, and a demo lead that looked
 *    real would be worse than an empty page.
 */

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'leads.json');

/* ---------------------------------------------------------- normalisation -- */

/** Trim, collapse whitespace, and cap. Applied to every field off the wire. */
function clean(value: unknown, maxLength = 200): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeLead(raw: Record<string, unknown>): Lead | null {
  const group = raw.group;
  if (!isGroupSlug(group)) return null;

  const weekRaw = String(raw.weekStart ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekRaw)) return null;
  const weekStart = weekStartOf(parseISODate(weekRaw));

  const lead: Lead = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : '',
    group,
    name: clean(raw.name),
    email: clean(raw.email).toLowerCase(),
    phone: clean(raw.phone, 40),
    university: clean(raw.university),
    country: clean(raw.country, 80),
    weekStart,
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
  };

  // A row with nothing identifying in it is not a lead; it is an empty form
  // submission or a stray blank line in a pasted block.
  const hasAnything = [lead.name, lead.email, lead.phone, lead.university, lead.country].some(
    (v) => v !== '',
  );
  if (!hasAnything) return null;

  if (lead.id === '') lead.id = leadId(lead);
  return lead;
}

/**
 * A stable id from the identifying fields, so re-pasting a block that overlaps a
 * previous one updates those rows instead of duplicating every lead. Email is the
 * strongest key; without one, name plus group plus week is the best available.
 */
function leadId(lead: Lead): string {
  const key = lead.email !== '' ? lead.email : `${lead.name}|${lead.weekStart}`;
  return `${lead.group}:${key.toLowerCase()}`;
}

function sortLeads(leads: Lead[]): Lead[] {
  return [...leads].sort((a, b) => {
    if (a.weekStart !== b.weekStart) return a.weekStart < b.weekStart ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

/* ----------------------------------------------------------------- reading */

/** Every stored lead, newest week first. Missing file means none yet. */
export async function getLeads(): Promise<Lead[]> {
  try {
    const text = await fs.readFile(STORE_FILE, 'utf8');
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return sortLeads(
      parsed
        .map((row) => normalizeLead(row as Record<string, unknown>))
        .filter((l): l is Lead => l !== null),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/* ----------------------------------------------------------------- writing */

async function writeLeads(leads: Lead[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_FILE, `${JSON.stringify(sortLeads(leads), null, 2)}\n`, 'utf8');
}

export interface SaveLeadsResult {
  added: number;
  updated: number;
  skipped: number;
  leads: Lead[];
}

/**
 * Save one or many leads. An incoming lead whose id already exists REPLACES it,
 * so pasting an overlapping block is safe.
 */
export async function saveLeads(inputs: LeadInput[]): Promise<SaveLeadsResult> {
  const now = new Date().toISOString();
  const normalized: Lead[] = [];
  let skipped = 0;

  for (const input of inputs) {
    const lead = normalizeLead({ ...input, createdAt: now } as Record<string, unknown>);
    if (!lead) {
      skipped += 1;
      continue;
    }
    normalized.push(lead);
  }

  const existing = await getLeads();
  const byId = new Map(existing.map((l) => [l.id, l]));
  let added = 0;
  let updated = 0;

  for (const lead of normalized) {
    if (byId.has(lead.id)) {
      updated += 1;
      // Keep the original createdAt: the lead arrived when it first arrived.
      lead.createdAt = byId.get(lead.id)?.createdAt ?? lead.createdAt;
    } else {
      added += 1;
    }
    byId.set(lead.id, lead);
  }

  const all = [...byId.values()];
  await writeLeads(all);
  return { added, updated, skipped, leads: sortLeads(all) };
}

export async function deleteLead(id: string): Promise<boolean> {
  const current = await getLeads();
  const next = current.filter((l) => l.id !== id);
  if (next.length === current.length) return false;
  await writeLeads(next);
  return true;
}

/* --------------------------------------------------------- pasted blocks -- */

/** Column order a pasted block is read in, when it has no header row. */
export const PASTE_COLUMNS: (keyof LeadInput)[] = [
  'name',
  'email',
  'phone',
  'university',
  'country',
];

const HEADER_ALIASES: Record<string, keyof LeadInput> = {
  name: 'name',
  fullname: 'name',
  studentname: 'name',
  email: 'email',
  emailaddress: 'email',
  mail: 'email',
  phone: 'phone',
  phoneno: 'phone',
  phonenumber: 'phone',
  mobile: 'phone',
  mobilenumber: 'phone',
  contact: 'phone',
  university: 'university',
  college: 'university',
  school: 'university',
  country: 'country',
  targetedcountry: 'country',
  targetcountry: 'country',
  destination: 'country',
};

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Parse a pasted block of rows into lead inputs.
 *
 * Accepts what a spreadsheet actually puts on the clipboard: tab-separated by
 * default, comma-separated if no tabs are present. A first row that looks like
 * headers is used to map the columns, so a pasted block whose columns are in a
 * different order still lands correctly; without one, PASTE_COLUMNS order is
 * assumed and stated in the UI.
 */
export function parseLeadBlock(
  text: string,
  group: GroupSlug,
  weekStart: string,
): { rows: LeadInput[]; usedHeader: boolean; columns: (keyof LeadInput)[] } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length === 0) return { rows: [], usedHeader: false, columns: PASTE_COLUMNS };

  // Tabs win when present: a university name may contain a comma, but never a tab.
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const split = (line: string) => line.split(delimiter).map((cell) => cell.trim());

  const first = split(lines[0]);
  const mapped = first.map((cell) => HEADER_ALIASES[normalizeKey(cell)]);
  // Treat row one as headers only if most of its cells are recognised names.
  const recognised = mapped.filter(Boolean).length;
  const usedHeader = recognised >= 2 && recognised >= Math.ceil(first.length / 2);

  const columns = usedHeader
    ? first.map((cell, i) => HEADER_ALIASES[normalizeKey(cell)] ?? PASTE_COLUMNS[i] ?? 'name')
    : PASTE_COLUMNS;

  const bodyLines = usedHeader ? lines.slice(1) : lines;
  const rows: LeadInput[] = bodyLines.map((line) => {
    const cells = split(line);
    const row: LeadInput = { group, weekStart };
    columns.forEach((column, i) => {
      const value = cells[i];
      if (value !== undefined && value !== '') {
        (row as unknown as Record<string, string>)[column] = value;
      }
    });
    return row;
  });

  return { rows, usedHeader, columns };
}

/* ------------------------------------------------------------- breakdowns -- */

export interface LeadTotals {
  total: number;
  thisWeek: number;
  universities: number;
  countries: number;
  /** Leads with no university recorded, so the breakdown's gap is explainable. */
  missingUniversity: number;
  missingCountry: number;
}

export function leadTotals(leads: Lead[], weekStart: string): LeadTotals {
  const named = (field: 'university' | 'country') =>
    new Set(leads.filter((l) => l[field] !== '').map((l) => l[field].toLowerCase()));

  return {
    total: leads.length,
    thisWeek: leads.filter((l) => l.weekStart === weekStart).length,
    universities: named('university').size,
    countries: named('country').size,
    missingUniversity: leads.filter((l) => l.university === '').length,
    missingCountry: leads.filter((l) => l.country === '').length,
  };
}

/**
 * Leads grouped by one field, largest first.
 *
 * Blank values are excluded rather than bucketed as "Unknown": the totals report
 * how many were blank, and a bar labelled "Unknown" competing with real
 * universities would read as though it were one.
 */
export function leadBreakdown(
  leads: Lead[],
  field: 'university' | 'country',
  limit = 12,
): LeadBreakdownRow[] {
  const counts = new Map<string, { label: string; leads: number }>();
  for (const lead of leads) {
    const raw = lead[field];
    if (raw === '') continue;
    const key = raw.toLowerCase();
    const current = counts.get(key);
    if (current) current.leads += 1;
    else counts.set(key, { label: raw, leads: 1 });
  }

  const withValue = leads.filter((l) => l[field] !== '').length;
  return [...counts.values()]
    .sort((a, b) => b.leads - a.leads || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((row) => ({
      ...row,
      sharePct: withValue === 0 ? 0 : (row.leads / withValue) * 100,
    }));
}

/** Leads per week over a window, oldest first — the funnel's time axis. */
export function leadsPerWeek(
  leads: Lead[],
  weeks: string[],
): { week: string; value: number | null }[] {
  return weeks.map((week) => ({
    week,
    value: leads.filter((l) => l.weekStart === week).length,
  }));
}

export function leadsForGroups(leads: Lead[], groups: GroupSlug[]): Lead[] {
  const set = new Set(groups);
  return leads.filter((l) => set.has(l.group));
}
