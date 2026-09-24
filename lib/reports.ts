import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  ActivityLevel,
  CommunitySlug,
  Ga4Figures,
  GroupSlug,
  ShortioFigures,
} from './types';
import { isCommunitySlug, isGroupSlug } from './groups';
import { isValidISODate } from './period';
import { currentWeekStart, weekEnd } from './weeks';
import { readJsonObject, vercelBlobEnabled, writeJsonObject } from './vercel-blob';

/**
 * Filed reports: one record per date range, and the one range currently
 * being reported on.
 *
 * Two ideas live here.
 *
 * The **active period** is a single date range that every section of the
 * dashboard reads from — member counts, leads, Instagram, WhatsApp, GA4 and
 * Short.io alike. It is set when a batch of WhatsApp exports is filed, and
 * from then on every other figure answers for that same window. Before this,
 * each section picked its own dates and the page was quietly reporting on
 * four different time spans at once.
 *
 * A **filed report** is one such range plus the numbers that were true for
 * it, keyed by the range and never overwritten by a later report. Keeping
 * the numbers (rather than only the range, and recomputing on demand) is
 * deliberate: a report is a historical artifact, and what it said at the time
 * shouldn't change retroactively. The snapshot is refreshed whenever
 * something is uploaded or entered *for that same period*, so it can't drift
 * from its own inputs — but once the active period moves on, the record is
 * settled and every "vs. last report" figure is measured against it.
 *
 * Same dual-backend pattern as every other store here: Vercel Blob when
 * BLOB_READ_WRITE_TOKEN is set, a local JSON file otherwise.
 */

const DATA_DIR = path.join(process.cwd(), 'data');
const REPORTS_FILE = 'reports.json';
const REPORTS_PATH = path.join(DATA_DIR, REPORTS_FILE);
const PERIOD_FILE = 'active-period.json';
const PERIOD_PATH = path.join(DATA_DIR, PERIOD_FILE);

/** An inclusive date range: the window one report covers. */
export interface ReportPeriod {
  start: string;
  end: string;
}

/** `2026-09-16:2026-09-23` — a period's stable identity. */
export function periodId(period: ReportPeriod): string {
  return `${period.start}:${period.end}`;
}

/** Parse a `start:end` id back into a period, or null when it isn't one. */
export function parsePeriodId(value: string | null | undefined): ReportPeriod | null {
  if (!value) return null;
  const [start, end] = value.split(':');
  if (!isValidISODate(start ?? '') || !isValidISODate(end ?? '')) return null;
  if (end < start) return null;
  return { start, end };
}

export function samePeriod(a: ReportPeriod, b: ReportPeriod): boolean {
  return a.start === b.start && a.end === b.end;
}

/* ------------------------------------------------------------- the numbers */

/** One community's line in a report. */
export interface CommunityReportLine {
  community: CommunitySlug;
  /** Total members as of the period's end date, or null if never entered. */
  members: number | null;
  /** Leads added during this period, or null if never entered. */
  leads: number | null;
  messageCount: number;
  uniqueActiveChatters: number;
  /** How many of this community's groups have a WhatsApp report for this period. */
  groupsWithEntry: number;
  groupCount: number;
}

/** One group's line in a report. */
export interface GroupReportLine {
  group: GroupSlug;
  community: CommunitySlug;
  messageCount: number | null;
  uniqueActiveChatters: number | null;
  activityLevel: ActivityLevel | null;
  mainTopics: string[];
}

/** Everything one report says, as of when it was last refreshed. */
export interface ReportSnapshot {
  communities: CommunityReportLine[];
  /** Sum of every community's member total; null when none has ever been entered. */
  totalMembers: number | null;
  /** Sum of every community's leads for this period; null when none has been entered. */
  totalLeads: number | null;
  instagramMembers: number | null;
  groups: GroupReportLine[];
  /** Landing-page traffic covering this period, if any export does. */
  ga4: Ga4Figures | null;
  /** Community #2's link clicks covering this period, if any export does. */
  shortio: ShortioFigures | null;
}

export interface FiledReport {
  id: string;
  periodStart: string;
  periodEnd: string;
  /** When this range first had anything filed against it. */
  filedAt: string;
  /** When its numbers were last refreshed. */
  updatedAt: string;
  snapshot: ReportSnapshot;
}

/* ------------------------------------------------------------- normalising */

function num(value: unknown): number {
  return Math.max(0, Math.round(Number(value) || 0));
}

function optionalNum(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((s) => String(s ?? '')).filter((s) => s !== '') : [];
}

function normalizeSnapshot(raw: unknown): ReportSnapshot {
  const r = (raw ?? {}) as Record<string, unknown>;

  const communities: CommunityReportLine[] = Array.isArray(r.communities)
    ? r.communities
        .map((row) => {
          const c = row as Record<string, unknown>;
          if (!isCommunitySlug(c.community)) return null;
          return {
            community: c.community,
            members: optionalNum(c.members),
            leads: optionalNum(c.leads),
            messageCount: num(c.messageCount),
            uniqueActiveChatters: num(c.uniqueActiveChatters),
            groupsWithEntry: num(c.groupsWithEntry),
            groupCount: num(c.groupCount),
          };
        })
        .filter((c): c is CommunityReportLine => c !== null)
    : [];

  const groups: GroupReportLine[] = Array.isArray(r.groups)
    ? r.groups
        .map((row) => {
          const g = row as Record<string, unknown>;
          if (!isGroupSlug(g.group) || !isCommunitySlug(g.community)) return null;
          const level = g.activityLevel;
          return {
            group: g.group,
            community: g.community,
            messageCount: optionalNum(g.messageCount),
            uniqueActiveChatters: optionalNum(g.uniqueActiveChatters),
            activityLevel:
              level === 'Low' || level === 'Medium' || level === 'High' ? level : null,
            mainTopics: strList(g.mainTopics),
          };
        })
        .filter((g): g is GroupReportLine => g !== null)
    : [];

  const ga4Raw = r.ga4 as Record<string, unknown> | null | undefined;
  const shortioRaw = r.shortio as Record<string, unknown> | null | undefined;

  return {
    communities,
    groups,
    totalMembers: optionalNum(r.totalMembers),
    totalLeads: optionalNum(r.totalLeads),
    instagramMembers: optionalNum(r.instagramMembers),
    ga4: ga4Raw
      ? {
          activeUsers: optionalNum(ga4Raw.activeUsers),
          newUsers: optionalNum(ga4Raw.newUsers),
          sessions: optionalNum(ga4Raw.sessions),
        }
      : null,
    shortio: shortioRaw
      ? {
          totalClicks: num(shortioRaw.totalClicks),
          links: Array.isArray(shortioRaw.links)
            ? shortioRaw.links
                .map((l) => {
                  const link = l as Record<string, unknown>;
                  return { path: String(link.path ?? '').trim(), clicks: num(link.clicks) };
                })
                .filter((l) => l.path !== '')
            : [],
        }
      : null,
  };
}

function normalizeReport(raw: unknown): FiledReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const periodStart = String(r.periodStart ?? '');
  const periodEnd = String(r.periodEnd ?? '');
  if (!isValidISODate(periodStart) || !isValidISODate(periodEnd)) return null;
  if (periodEnd < periodStart) return null;
  return {
    id: periodId({ start: periodStart, end: periodEnd }),
    periodStart,
    periodEnd,
    filedAt: String(r.filedAt ?? new Date().toISOString()),
    updatedAt: String(r.updatedAt ?? r.filedAt ?? new Date().toISOString()),
    snapshot: normalizeSnapshot(r.snapshot),
  };
}

/**
 * Oldest first, by the date the period *starts* — the same ordering
 * `previousReport` uses, so "the latest report" and "the one before this one"
 * can never disagree about which way round two touching periods go.
 */
function sortReports(reports: FiledReport[]): FiledReport[] {
  return [...reports].sort((a, b) =>
    a.periodStart < b.periodStart
      ? -1
      : a.periodStart > b.periodStart
        ? 1
        : a.periodEnd < b.periodEnd
          ? -1
          : 1,
  );
}

/* ---------------------------------------------------------------- the store */

async function readLocalJson(file: string, fallback: unknown): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeLocalJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/** Every filed report, oldest first. */
export async function getReports(): Promise<FiledReport[]> {
  const raw = vercelBlobEnabled()
    ? await readJsonObject<unknown>(REPORTS_FILE, [])
    : await readLocalJson(REPORTS_PATH, []);
  if (!Array.isArray(raw)) return [];
  return sortReports(raw.map(normalizeReport).filter((r): r is FiledReport => r !== null));
}

/**
 * Write the numbers for one period, creating the record the first time and
 * refreshing it after that. `filedAt` survives a refresh — it records when
 * the report first existed, not when it was last touched.
 */
export async function upsertReport(
  period: ReportPeriod,
  snapshot: ReportSnapshot,
): Promise<FiledReport> {
  const id = periodId(period);
  const existing = await getReports();
  const previous = existing.find((r) => r.id === id);
  const now = new Date().toISOString();
  const report: FiledReport = {
    id,
    periodStart: period.start,
    periodEnd: period.end,
    filedAt: previous?.filedAt ?? now,
    updatedAt: now,
    snapshot,
  };
  const next = sortReports([...existing.filter((r) => r.id !== id), report]);
  if (vercelBlobEnabled()) await writeJsonObject(REPORTS_FILE, next);
  else await writeLocalJson(REPORTS_PATH, next);
  return report;
}

/** Remove one filed report. False when the id wasn't there. */
export async function deleteReport(id: string): Promise<boolean> {
  const current = await getReports();
  const next = current.filter((r) => r.id !== id);
  if (next.length === current.length) return false;
  if (vercelBlobEnabled()) await writeJsonObject(REPORTS_FILE, next);
  else await writeLocalJson(REPORTS_PATH, next);
  return true;
}

/* ------------------------------------------------------------- selectors -- */

export function findReport(reports: FiledReport[], period: ReportPeriod): FiledReport | null {
  const id = periodId(period);
  return reports.find((r) => r.id === id) ?? null;
}

/**
 * The report a new one is measured against: the most recent filed report that
 * *started* before this period started.
 *
 * Started, not ended. This report runs Wednesday to Wednesday, so consecutive
 * periods share a date — 16–23 Sep follows 9–16 Sep. An "ended before this
 * began" rule reads that shared date as an overlap and finds no baseline at
 * all, which silently blanked every comparison column on the report. Ordering
 * by start date is unambiguous whether or not periods touch, and still picks
 * the chronologically previous report when one is re-filed or back-filled out
 * of order.
 */
export function previousReport(
  reports: FiledReport[],
  period: ReportPeriod,
): FiledReport | null {
  const earlier = reports
    .filter((r) => r.periodStart < period.start)
    .sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1));
  return earlier[earlier.length - 1] ?? null;
}

/** The most recently-ending filed report, whatever its range. */
export function latestReport(reports: FiledReport[]): FiledReport | null {
  return reports[reports.length - 1] ?? null;
}

export function reportPeriod(report: FiledReport): ReportPeriod {
  return { start: report.periodStart, end: report.periodEnd };
}

/* ------------------------------------------------------- the active period */

/**
 * The period every section currently reports on.
 *
 * Falls back, in order, to: the most recently filed report's range, then the
 * current Monday–Sunday week. A brand-new install therefore opens on this
 * week rather than on nothing, and an install with history opens where the
 * last report left off.
 */
export async function getActivePeriod(): Promise<ReportPeriod> {
  const raw = vercelBlobEnabled()
    ? await readJsonObject<unknown>(PERIOD_FILE, null)
    : await readLocalJson(PERIOD_PATH, null);

  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const start = String(r.start ?? '');
    const end = String(r.end ?? '');
    if (isValidISODate(start) && isValidISODate(end) && end >= start) return { start, end };
  }

  const latest = latestReport(await getReports());
  if (latest) return reportPeriod(latest);

  const week = currentWeekStart();
  return { start: week, end: weekEnd(week) };
}

/** Make `period` the one every section reports on. */
export async function setActivePeriod(period: ReportPeriod): Promise<ReportPeriod> {
  if (vercelBlobEnabled()) await writeJsonObject(PERIOD_FILE, period);
  else await writeLocalJson(PERIOD_PATH, period);
  return period;
}
