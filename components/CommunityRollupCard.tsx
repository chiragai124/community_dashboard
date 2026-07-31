import Link from 'next/link';
import type { CommunityConfig, RollupTotals } from '@/lib/types';
import { countNoun } from '@/lib/groups';
import { formatExact, formatPercent, formatSigned, formatSignedPercent } from '@/lib/metrics';

/**
 * One community rolled up to a single card, for the merged view. Deliberately
 * mirrors GroupCard's shape so the merged overview reads as the same kind of
 * comparison, one level up.
 */
export function CommunityRollupCard({
  community,
  totals,
  /** Growth of the pooled member count vs last week, as a percentage. */
  growthPct,
}: {
  community: CommunityConfig;
  totals: RollupTotals;
  growthPct: number | null;
}) {
  const direction =
    totals.newMembers > 0 ? 'up' : totals.newMembers < 0 ? 'down' : 'flat';
  const noun = community.groupNoun.toLowerCase();

  return (
    <Link href={`/c/${community.slug}`} className="groupCard">
      <div className="groupCard__head">
        <span className="groupCard__flag" aria-hidden="true">
          ◆
        </span>
        <span className="groupCard__name">{community.label}</span>
        <span className="groupCard__badge">
          <span className="badge badge--neutral">{countNoun(totals.groupCount, noun)}</span>
        </span>
      </div>

      <div className="groupCard__body">
        <div>
          <div className="groupCard__figure">
            <span className="groupCard__members">{formatExact(totals.members)}</span>
            <span className="groupCard__membersLabel">members</span>
          </div>
          <div className="groupCard__delta">
            <div>
              <span className={`delta delta--${direction}`}>
                <span className="delta__arrow" aria-hidden="true">
                  {direction === 'up' ? '▲' : direction === 'down' ? '▼' : '■'}
                </span>{' '}
                {formatSigned(totals.newMembers)}
              </span>{' '}
              <span className="muted">new members</span>
            </div>
            <div className="muted">
              {growthPct !== null
                ? `${formatSignedPercent(growthPct)} vs last week`
                : 'vs last week'}
            </div>
          </div>
          <div className="stat__hint" style={{ marginTop: 2 }}>
            {community.name}
          </div>
        </div>

        <div className="groupCard__rows">
          {/* Null = this community isn't covered by the source, so the row is
              omitted rather than shown as a fake zero. */}
        </div>
      </div>

      <div className="groupCard__foot">
        Open {community.label}
        <span aria-hidden="true">→</span>
      </div>
    </Link>
  );
}
