'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ActivityLevel, GroupSlug } from '@/lib/types';
import { formatExact, formatPercent, formatSignedPercent } from '@/lib/metrics';
import { ActivityBadge } from './StatCard';

/**
 * All five groups, every key metric as a column, sortable by any of them.
 *
 * Serialised to plain values by the page so this can be a client component
 * without shipping the whole metrics graph to the browser.
 */
export interface ComparisonRow {
  group: GroupSlug;
  label: string;
  flag: string;
  /** Link to the group's detail page — community-scoped. */
  href: string;
  /** Community label, shown as a column only in the merged view. */
  communityLabel?: string;
  totalMembers: number | null;
  newMembers: number | null;
  memberGrowthPct: number | null;
  pollResponses: number;
  pollResponseRatePct: number | null;
  dmsSent: number;
  dmReplies: number;
  dmReplyRatePct: number | null;
  totalLeads: number;
  totalSessions: number;
  /** leads ÷ sessions, as a percentage. */
  leadConversionPct: number | null;
  activityLevel: ActivityLevel | null;
  hasEntry: boolean;
}

type SortKey =
  | 'label'
  | 'communityLabel'
  | 'totalMembers'
  | 'newMembers'
  | 'memberGrowthPct'
  | 'pollResponseRatePct'
  | 'dmsSent'
  | 'dmReplyRatePct'
  | 'totalLeads'
  | 'totalSessions'
  | 'leadConversionPct'
  | 'activityLevel';

const ACTIVITY_RANK: Record<ActivityLevel, number> = { Low: 1, Medium: 2, High: 3 };

const COLUMNS: {
  key: SortKey;
  label: string;
  numeric: boolean;
  title: string;
}[] = [
  { key: 'label', label: 'Group', numeric: false, title: 'Group or segment' },
  { key: 'communityLabel', label: 'Community', numeric: false, title: 'Parent community' },
  { key: 'totalMembers', label: 'Members', numeric: true, title: 'Member count at week end' },
  { key: 'newMembers', label: 'New', numeric: true, title: 'New members this week' },
  { key: 'memberGrowthPct', label: 'Growth', numeric: true, title: 'Week-over-week member growth' },
  {
    key: 'pollResponseRatePct',
    label: 'Poll rate',
    numeric: true,
    title: 'Poll responses ÷ member count',
  },
  { key: 'dmsSent', label: 'DMs', numeric: true, title: '1:1 DMs sent to leads' },
  { key: 'dmReplyRatePct', label: 'DM reply', numeric: true, title: 'Replies ÷ DMs sent' },
  { key: 'totalLeads', label: 'Leads', numeric: true, title: 'Registrations attributed this week' },
  { key: 'totalSessions', label: 'Sessions', numeric: true, title: 'GA4 sessions this week' },
  {
    key: 'leadConversionPct',
    label: 'Lead/session',
    numeric: true,
    title: 'Leads ÷ GA4 sessions',
  },
  { key: 'activityLevel', label: 'Activity', numeric: false, title: 'Manually logged activity level' },
];

function sortValue(row: ComparisonRow, key: SortKey): number | string {
  if (key === 'label') return row.label;
  if (key === 'communityLabel') return row.communityLabel ?? '';
  if (key === 'activityLevel') return row.activityLevel ? ACTIVITY_RANK[row.activityLevel] : 0;
  const value = row[key];
  return value === null || value === undefined ? Number.NEGATIVE_INFINITY : value;
}

export function ComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  // The community column only earns its space when rows span more than one.
  const showCommunity = new Set(rows.map((r) => r.communityLabel ?? '')).size > 1;
  const columns = COLUMNS.filter((c) => c.key !== 'communityLabel' || showCommunity);
  const [sortKey, setSortKey] = useState<SortKey>('totalMembers');
  const [descending, setDescending] = useState(true);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (typeof av === 'string' || typeof bv === 'string') {
        const cmp = String(av).localeCompare(String(bv));
        return descending ? -cmp : cmp;
      }
      return descending ? bv - av : av - bv;
    });
    return copy;
  }, [rows, sortKey, descending]);

  function toggle(key: SortKey) {
    if (key === sortKey) {
      setDescending((d) => !d);
      return;
    }
    setSortKey(key);
    // Names read best A→Z; every metric reads best highest-first.
    setDescending(key !== 'label');
  }

  // The leader on the sorted metric gets a subtle accent, so "fastest growing"
  // is visible without reading every number.
  const leaderGroup =
    sortKey !== 'label' && descending && sorted.length > 0 ? sorted[0].group : null;

  return (
    <>
      <div className="tableWrap">
        <table className="data">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} className={col.numeric ? 'num' : undefined} title={col.title}>
                  <button
                    type="button"
                    className={`sortBtn${sortKey === col.key ? ' sortBtn--active' : ''}`}
                    onClick={() => toggle(col.key)}
                    aria-label={`Sort by ${col.label}`}
                  >
                    {col.label}
                    <span className="sortBtn__caret" aria-hidden="true">
                      {sortKey === col.key ? (descending ? '▼' : '▲') : '↕'}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const isLeader = row.group === leaderGroup;
              return (
                <tr key={row.group}>
                  <td className="name">
                    <Link href={row.href} className={isLeader ? 'tableLead' : undefined}>
                      <span aria-hidden="true">{row.flag}</span> {row.label}
                    </Link>
                  </td>
                  {showCommunity ? (
                    <td className="muted">{row.communityLabel ?? '—'}</td>
                  ) : null}
                  <td className="num">{formatExact(row.totalMembers)}</td>
                  <td className="num">{formatExact(row.newMembers)}</td>
                  <td className="num">{formatSignedPercent(row.memberGrowthPct)}</td>
                  <td className="num">{formatPercent(row.pollResponseRatePct)}</td>
                  <td className="num">{formatExact(row.dmsSent)}</td>
                  <td className="num">{formatPercent(row.dmReplyRatePct)}</td>
                  <td className="num">{formatExact(row.totalLeads)}</td>
                  <td className="num">{formatExact(row.totalSessions)}</td>
                  <td className="num">{formatPercent(row.leadConversionPct)}</td>
                  <td>
                    <ActivityBadge level={row.activityLevel} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="tableFoot">
        Sorted by {columns.find((c) => c.key === sortKey)?.label}
        {descending ? ', highest first' : ', lowest first'}. Click any column to re-sort.
        {rows.some((r) => !r.hasEntry)
          ? ' Groups without a weekly entry show — for manual metrics.'
          : ''}
      </div>
    </>
  );
}
