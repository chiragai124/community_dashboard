import Link from 'next/link';
import type { GroupWeekMetrics } from '@/lib/types';
import { communityOf, getGroup, singularize } from '@/lib/groups';
import { formatExact, formatSigned, formatSignedPercent } from '@/lib/metrics';
import { ActivityBadge } from './StatCard';
import { WeekQualitative } from './WeekQualitative';

/**
 * One group on the overview grid: member count, new members, activity level and
 * leads this week — the at-a-glance comparison set.
 *
 * The card is a link, but the week-notes expander is a sibling of that link
 * rather than a child: a <summary> inside an <a> is invalid HTML and clicking it
 * would navigate instead of expanding. So the anchor covers the figures and the
 * expander sits below it, inside the same card frame.
 */
export function GroupCard({ metrics }: { metrics: GroupWeekMetrics }) {
  const group = getGroup(metrics.group);
  if (!group) return null;

  const hasEntry = metrics.entry !== null;
  const noun = singularize(communityOf(metrics.group)?.groupNoun ?? 'Groups').toLowerCase();
  const growth = metrics.memberGrowthPct;
  const direction = growth === null ? 'flat' : growth > 0 ? 'up' : growth < 0 ? 'down' : 'flat';
  const href = `/c/${group.community}/group/${group.slug}`;

  return (
    <article className="groupCard">
      <Link href={href} className="groupCard__link">
      <div className="groupCard__head">
        <span className="groupCard__flag" aria-hidden="true">
          {group.flag}
        </span>
        <span className="groupCard__name">{group.label}</span>
        <span className="groupCard__badge">
          <ActivityBadge level={metrics.activityLevel} />
        </span>
      </div>

      <div className="groupCard__body">
        <div>
          <div className="groupCard__figure">
            <span className="groupCard__members">
              {hasEntry ? formatExact(metrics.totalMembers) : '—'}
            </span>
            <span className="groupCard__membersLabel">members</span>
          </div>
          {/* Two explicit lines rather than one flex row: at five-across the
              single line wrapped mid-figure. */}
          <div className="groupCard__delta">
            {metrics.newMembers !== null ? (
              <>
                <div>
                  <span className={`delta delta--${direction}`}>
                    <span className="delta__arrow" aria-hidden="true">
                      {direction === 'up' ? '▲' : direction === 'down' ? '▼' : '■'}
                    </span>{' '}
                    {formatSigned(metrics.newMembers)}
                  </span>{' '}
                  <span className="muted">new members</span>
                </div>
                <div className="muted">
                  {growth !== null ? `${formatSignedPercent(growth)} vs last week` : 'vs last week'}
                </div>
              </>
            ) : (
              <div className="muted">
                {hasEntry ? 'First week recorded' : 'No entry for this week yet'}
              </div>
            )}
          </div>
        </div>

      </div>
      </Link>

      {/* Between the figures and the CTA, so the call to action stays the last
          row of the card. */}
      <WeekQualitative entry={metrics.entry} variant="card" />

      <Link href={href} className="groupCard__foot" tabIndex={-1} aria-hidden="true">
        {/* "View segment" in a community whose subdivisions are segments. */}
        {hasEntry ? `View ${noun}` : 'Add this week’s numbers'}
        <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}
