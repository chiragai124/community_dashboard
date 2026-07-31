import { notFound } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { GroupCard } from '@/components/GroupCard';
import { StatCard, StatCardPercentDelta } from '@/components/StatCard';
import { DemoNotice } from '@/components/DemoNotice';
import {
  IMPORTED_FIGURES,
  SOURCE_SERIES,
  communityImported,
  communityTotals,
  entryWeekOptions,
  groupsInCommunity,
  importedSeries,
  loadDashboard,
  newMembersPerWeek,
  sourceSplitFor,
  sourceSplitRows,
} from '@/lib/dashboard';
import { MemberSourceSplit } from '@/components/MemberSourceSplit';
import { MultiGroupTrend, SingleTrendChart } from '@/components/charts';
import { countNoun, getCommunity, getGroup, importsFor } from '@/lib/groups';
import { SOURCE_META } from '@/lib/imports';
import { ImportPanel } from '@/components/ImportPanel';
import { ImportedFigures } from '@/components/ImportedFigures';
import { formatExact, formatPercent, formatSigned } from '@/lib/metrics';
import { formatWeekRange } from '@/lib/weeks';

export const dynamic = 'force-dynamic';

/**
 * One community's overview: its groups side by side, its pooled totals, its
 * notes and which of its groups still need an entry. Generic across
 * communities — a community with one segment renders the same way as one with
 * five.
 */
export default async function CommunityOverviewPage({
  params,
}: {
  params: Promise<{ community: string }>;
}) {
  const { community: communitySlug } = await params;
  const community = getCommunity(communitySlug);
  if (!community) notFound();

  const data = await loadDashboard();
  const perGroup = groupsInCommunity(data, community.slug);
  const totals = communityTotals(data, community.slug);

  const notes = perGroup.filter((m) => m.notes.trim() !== '');
  const missing = perGroup.filter((m) => m.entry === null);
  const movers = [...perGroup]
    .filter((m) => m.memberGrowthPct !== null)
    .sort((a, b) => (b.memberGrowthPct ?? 0) - (a.memberGrowthPct ?? 0))
    .slice(0, 3);

  const noun = community.groupNoun.toLowerCase();

  // Imported figures are community-level: one Short.io and one GA4 file a week.
  const sources = importsFor(community.slug).map((source) => SOURCE_META[source]);
  const imported = communityImported(data, community.slug);
  const importSeries = Object.fromEntries(
    IMPORTED_FIGURES.map((figure) => [
      figure.key,
      importedSeries(data, community.slug, figure.pick),
    ]),
  );
  const communityImports = data.imports.filter((f) => f.community === community.slug);

  // Item 4: the hand-entered source split, pooled over this community's groups,
  // plus the growth / clicks / sessions comparison beside it.
  const groupSlugs = perGroup.map((m) => m.group);
  const split = sourceSplitFor(data.entries, groupSlugs, data.displayWeek);
  const splitRows = sourceSplitRows(data, groupSlugs);
  const hasSplitHistory = splitRows.some((row) =>
    SOURCE_SERIES.some((series) => typeof row[series.key] === 'number'),
  );
  const growthPoints = newMembersPerWeek(data, groupSlugs);
  const clickPoints = importedSeries(data, community.slug, (w) => w.shortio?.totalClicks ?? null);
  const sessionPoints = importedSeries(data, community.slug, (w) => w.ga4?.sessions ?? null);
  const hasImportedHistory = [clickPoints, sessionPoints].some((series) =>
    series.some((p) => p.value !== null),
  );

  return (
    <>
      <PageHeader
        eyebrow={`${community.label} · Overview`}
        title={community.name}
        weekStart={data.displayWeek}
      />

      <div className="content">
        <DemoNotice demoEntries={data.demoEntries} />

        <div className="grid grid--stats">
          <StatCard
            label={totals.groupCount === 1 ? 'Members' : `Members, all ${noun}`}
            value={formatExact(totals.members)}
            delta={totals.newMembers}
            deltaSuffix="new this week"
            accent
          />
          <StatCardPercentDelta
            label="Poll response rate"
            value={formatPercent(totals.pollResponseRatePct)}
            hint="Responses ÷ members, pooled"
          />
          <StatCardPercentDelta
            label="DM reply rate"
            value={formatPercent(totals.dmReplyRatePct)}
            hint="Replies ÷ DMs sent, pooled"
          />
        </div>

        {sources.length > 0 ? (
          <>
            <h2 className="sectionTitle">
              Imported figures · week of {formatWeekRange(data.displayWeek)}
            </h2>
            <ImportedFigures
              week={imported}
              series={importSeries}
              emptyHint={`Nothing imported for this week yet. Open “Import data” below to upload the ${sources
                .map((s) => s.label)
                .join(' and ')} export.`}
            />
            <div style={{ marginTop: 14 }}>
              <ImportPanel
                community={community.slug}
                communityLabel={community.label}
                weekOptions={entryWeekOptions()}
                defaultWeek={data.displayWeek}
                sources={sources}
                existing={communityImports}
              />
            </div>
          </>
        ) : null}

        <h2 className="sectionTitle">
          Member growth by source · week of {formatWeekRange(data.displayWeek)}
        </h2>
        <MemberSourceSplit
          split={split}
          newMembers={totals.newMembers}
          title="New members by source"
          subtitle={`Hand-entered, pooled across ${community.label}'s ${noun}`}
        />

        {hasSplitHistory ? (
          <section className="card" style={{ marginTop: 14 }}>
            <div className="card__head">
              <div>
                <div className="card__title">
                  New members by source · last {splitRows.length} weeks
                </div>
                <div className="card__sub">
                  One line per source. Click a source to bring it forward.
                </div>
              </div>
            </div>
            <div className="card__body">
              <MultiGroupTrend
                rows={splitRows}
                series={SOURCE_SERIES}
                unit="count"
                height={300}
                metricLabel="New members"
              />
            </div>
          </section>
        ) : null}

        {/* Growth, clicks and sessions as three panels rather than one chart:
            members, clicks and sessions are different units, so a shared y axis
            would be meaningless and a second axis would invite reading a crossing
            point as a relationship. Same x range, independent scales, stated. */}
        {hasImportedHistory ? (
          <>
            <h3 className="sectionTitle">Growth alongside traffic</h3>
            <div className="grid grid--halves">
              <section className="card">
                <div className="card__head">
                  <div>
                    <div className="card__title">New members</div>
                    <div className="card__sub">Manual weekly entries</div>
                  </div>
                </div>
                <div className="card__body">
                  <SingleTrendChart
                    points={growthPoints}
                    seriesLabel="New members"
                    unit="count"
                    height={196}
                  />
                </div>
              </section>
              <section className="card">
                <div className="card__head">
                  <div>
                    <div className="card__title">Link clicks</div>
                    <div className="card__sub">Short.io imports</div>
                  </div>
                </div>
                <div className="card__body">
                  <SingleTrendChart
                    points={clickPoints}
                    seriesLabel="Clicks"
                    unit="count"
                    height={196}
                  />
                </div>
              </section>
              <section className="card">
                <div className="card__head">
                  <div>
                    <div className="card__title">Sessions</div>
                    <div className="card__sub">GA4 imports</div>
                  </div>
                </div>
                <div className="card__body">
                  <SingleTrendChart
                    points={sessionPoints}
                    seriesLabel="Sessions"
                    unit="count"
                    height={196}
                  />
                </div>
              </section>
            </div>
            <p className="chartNote">
              Three separate scales over the same weeks. Clicks and sessions are traffic, not
              joins — read these together for context, not as a breakdown of where members
              came from. The split above is the breakdown, and it is entered by hand.
            </p>
          </>
        ) : null}

        <h2 className="sectionTitle">
          {community.groupNoun} · week of {formatWeekRange(data.displayWeek)}
        </h2>
        <div className={`grid ${perGroup.length > 2 ? 'grid--groups' : 'grid--halves'}`}>
          {perGroup.map((metrics) => (
            <GroupCard key={metrics.group} metrics={metrics} />
          ))}
        </div>

        <div className="grid grid--halves" style={{ marginTop: 22 }}>
          <section className="card">
            <div className="card__head">
              <div>
                <div className="card__title">This week’s notes</div>
                <div className="card__sub">Straight from the manual weekly entries</div>
              </div>
            </div>
            <div className="card__body">
              {notes.length === 0 ? (
                <div className="emptyState">No notes logged for this week yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                  {notes.map((metrics) => {
                    const group = getGroup(metrics.group);
                    return (
                      <div key={metrics.group}>
                        <div
                          style={{
                            fontSize: 12.5,
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <span aria-hidden="true">{group?.flag}</span>
                          {group?.label}
                        </div>
                        <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--ink-secondary)' }}>
                          {metrics.notes}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card__head">
              <div>
                <div className="card__title">Weekly entry status</div>
                <div className="card__sub">
                  {totals.groupsWithEntry} of {countNoun(totals.groupCount, noun)} logged for
                  this week
                </div>
              </div>
            </div>
            <div className="card__body">
              {missing.length === 0 ? (
                <div className="emptyState">
                  {totals.groupCount === 1 ? 'Logged' : `All ${noun} are logged`} for{' '}
                  {formatWeekRange(data.displayWeek)}.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {missing.map((metrics) => {
                    const group = getGroup(metrics.group);
                    return (
                      <Link
                        key={metrics.group}
                        href={`/c/${community.slug}/group/${metrics.group}`}
                        className="prefillNote"
                        style={{ display: 'block' }}
                      >
                        <strong>
                          {group?.flag} {group?.label}
                        </strong>{' '}
                        has no entry for this week — add it →
                      </Link>
                    );
                  })}
                </div>
              )}
              <p className="chartNote">
                Manual entry takes about a minute each: member count, polls, DMs, activity.
              </p>
            </div>
          </section>
        </div>

        {/* Needs at least two weeks of entries to rank anything — hidden rather
            than left as a heading over an empty row. Also pointless for a
            single-group community, where there is nothing to rank against. */}
        {movers.length > 1 ? (
          <>
            <h2 className="sectionTitle">Fastest movers this week</h2>
            <div className="grid grid--stats">
              {movers.map((metrics, index) => {
                const group = getGroup(metrics.group);
                return (
                  <StatCardPercentDelta
                    key={metrics.group}
                    label={`${index + 1}. ${group?.label ?? metrics.group} member growth`}
                    value={formatPercent(metrics.memberGrowthPct)}
                    hint={`${formatSigned(metrics.newMembers)} new members`}
                    accent={index === 0}
                  />
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
