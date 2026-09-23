import type { CommunityConfig } from '@/lib/types';
import { StatCard } from './StatCard';
import { formatExact, formatSigned, formatSignedPercent } from '@/lib/metrics';
import { weeksSinceCreated } from '@/lib/instagram';

/**
 * The Overview page's report sections, in the order the weekly report reads:
 * member counts, the Instagram broadcast channel, then the leads funnel.
 *
 * All three answer the same question in different units — how much bigger is
 * this than last time — so all three are built the same way: the previous
 * report's own figure, this period's figure, and the change between them,
 * with the comparison named rather than implied. Nothing here recomputes a
 * baseline; it is handed the previous report's numbers (see lib/reports.ts).
 */

/** A change cell: arrow, absolute change, and the percentage where it means something. */
function Change({ current, previous }: { current: number | null; previous: number | null }) {
  if (current === null || previous === null) {
    return <span className="muted">—</span>;
  }
  const change = current - previous;
  // A percentage of zero is not a large increase, it is undefined — so the
  // absolute change stands alone rather than being dressed up as "+∞%".
  const pct = previous > 0 ? (change / previous) * 100 : null;
  const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  return (
    <span className={`delta delta--${direction}`}>
      <span className="delta__arrow" aria-hidden="true">
        {direction === 'up' ? '▲' : direction === 'down' ? '▼' : '■'}
      </span>{' '}
      {formatSigned(change)}
      {pct !== null ? <span className="muted"> ({formatSignedPercent(pct)})</span> : null}
    </span>
  );
}

/* ------------------------------------------------------------ member count */

export interface MemberRow {
  community: CommunityConfig;
  current: number | null;
  previous: number | null;
}

export function MemberCountTable({
  rows,
  previousLabel,
}: {
  rows: MemberRow[];
  /** Which report the "last report" column is, e.g. "9 - 15 Sep 2026". */
  previousLabel: string | null;
}) {
  const totalCurrent = rows.reduce((sum, r) => sum + (r.current ?? 0), 0);
  const withPrevious = rows.filter((r) => r.previous !== null);
  // Only communities that have a previous figure contribute to the previous
  // total — otherwise a community joining this period would look like growth
  // from zero rather than a community with nothing to compare.
  const totalPrevious =
    withPrevious.length > 0 ? withPrevious.reduce((sum, r) => sum + (r.previous ?? 0), 0) : null;
  const anyEntered = rows.some((r) => r.current !== null);

  return (
    <section className="card">
      <div className="card__head">
        <div>
          <div className="card__title">Member count</div>
          <div className="card__sub">
            {previousLabel
              ? `Total members per community, against the report filed for ${previousLabel}.`
              : 'Total members per community. The comparison appears once a second report is filed.'}
          </div>
        </div>
      </div>
      <div className="card__body">
        {!anyEntered ? (
          <div className="emptyState">
            No member totals entered yet. Add one on each community&rsquo;s tab.
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Community</th>
                <th scope="col" className="num">
                  Last report
                </th>
                <th scope="col" className="num">
                  This report
                </th>
                <th scope="col" className="num">
                  Change
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.community.slug}>
                  <th scope="row">{row.community.label}</th>
                  <td className="num">{formatExact(row.previous)}</td>
                  <td className="num">{formatExact(row.current)}</td>
                  <td className="num">
                    <Change current={row.current} previous={row.previous} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">All communities</th>
                <td className="num">{formatExact(totalPrevious)}</td>
                <td className="num">
                  <strong>{formatExact(totalCurrent)}</strong>
                </td>
                <td className="num">
                  <Change current={totalCurrent} previous={totalPrevious} />
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------ Instagram channel */

export function InstagramSection({
  members,
  previousMembers,
  createdOn,
  periodEnd,
  previousLabel,
}: {
  members: number | null;
  previousMembers: number | null;
  createdOn: string | null;
  periodEnd: string;
  previousLabel: string | null;
}) {
  const weeks = weeksSinceCreated(createdOn, periodEnd);
  const change = members !== null && previousMembers !== null ? members - previousMembers : null;

  return (
    <section className="card">
      <div className="card__head">
        <div>
          <div className="card__title">Instagram broadcast channel</div>
          <div className="card__sub">
            {createdOn
              ? `Created ${createdOn}${weeks !== null ? ` · running for ${weeks} week${weeks === 1 ? '' : 's'}` : ''}`
              : 'Creation date not set yet'}
          </div>
        </div>
      </div>
      <div className="card__body">
        {members === null ? (
          <div className="emptyState">
            No member count entered for this period yet.
          </div>
        ) : (
          <div className="grid grid--stats">
            <StatCard
              label="Channel members"
              value={formatExact(members)}
              delta={change}
              deltaSuffix={previousLabel ? `vs ${previousLabel}` : undefined}
              hint={change === null ? 'First reading on file' : undefined}
              accent
            />
            {previousMembers !== null ? (
              <StatCard
                label="At last report"
                value={formatExact(previousMembers)}
                hint={previousLabel ?? undefined}
              />
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- leads funnel -- */

export interface LeadRow {
  community: CommunityConfig;
  current: number | null;
  previous: number | null;
}

/**
 * Leads added to the CRM this period, per community.
 *
 * A flow, not a level: each figure is what came in *during* the period, so
 * the total is a sum across communities and the comparison is against the
 * previous report's sum — never a difference between two running totals.
 */
export function LeadsFunnel({
  rows,
  previousLabel,
}: {
  rows: LeadRow[];
  previousLabel: string | null;
}) {
  const entered = rows.filter((r) => r.current !== null);
  const total = entered.length > 0 ? entered.reduce((sum, r) => sum + (r.current ?? 0), 0) : null;
  const withPrevious = rows.filter((r) => r.previous !== null);
  const previousTotal =
    withPrevious.length > 0 ? withPrevious.reduce((sum, r) => sum + (r.previous ?? 0), 0) : null;
  const max = Math.max(...rows.map((r) => r.current ?? 0), 1);

  return (
    <section className="card">
      <div className="card__head">
        <div>
          <div className="card__title">Accommodation poll &amp; follow-up funnel</div>
          <div className="card__sub">
            Leads added to the CRM during this period, entered per community.
          </div>
        </div>
      </div>
      <div className="card__body">
        {total === null ? (
          <div className="emptyState">
            No leads entered for this period yet. Add a figure on each community&rsquo;s tab.
          </div>
        ) : (
          <>
            <div className="grid grid--stats">
              <StatCard
                label="Leads added this period"
                value={formatExact(total)}
                delta={previousTotal !== null ? total - previousTotal : null}
                deltaSuffix={previousLabel ? `vs ${previousLabel}` : undefined}
                hint={previousTotal === null ? 'First report with leads on file' : undefined}
                accent
              />
            </div>

            {/* Horizontal bars: the communities are a nominal category with no
                order of their own, and length is the encoding people read
                most accurately. */}
            <div className="hbars" style={{ marginTop: 14 }}>
              {rows.map((row) => (
                <div key={row.community.slug}>
                  <div className="hbar__top">
                    <span className="hbar__name">{row.community.label}</span>
                    <span className="hbar__val">
                      {formatExact(row.current)}
                      {row.previous !== null ? (
                        <span className="muted">
                          {' '}
                          <Change current={row.current} previous={row.previous} />
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div
                    className="hbar__track"
                    role="img"
                    aria-label={`${row.community.label}: ${formatExact(row.current)} leads`}
                  >
                    <div
                      className="hbar__fill"
                      style={{ width: `${Math.max(((row.current ?? 0) / max) * 100, 2)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {entered.length < rows.length ? (
              <p className="chartNote">
                {rows.length - entered.length} communit
                {rows.length - entered.length === 1 ? 'y has' : 'ies have'} no leads figure for this
                period, so {rows.length - entered.length === 1 ? 'it is' : 'they are'} not counted in
                the total.
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
