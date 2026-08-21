import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { StatCard, StatCardPercentDelta, ActivityBadge } from '@/components/StatCard';
import { WhatsappImportPanel } from '@/components/WhatsappImportPanel';
import { MemberComparison } from '@/components/MemberComparison';
import { splitNotes } from '@/lib/notes';
import { SingleTrendChart, Sparkline } from '@/components/charts';
import { TrendingTopic } from '@/components/TrendingTopic';
import { SentimentPanel, hasSentiment } from '@/components/SentimentPanel';
import { getCommunity, getGroup } from '@/lib/groups';
import { SOURCE_META } from '@/lib/imports';
import { groupPeriodSeries, loadDashboard } from '@/lib/dashboard';
import { formatExact, formatPercent } from '@/lib/metrics';
import { formatDateRange, formatShortDate } from '@/lib/period';

// Every figure here is read at request time — nothing is prerendered.
export const dynamic = 'force-dynamic';

/**
 * One group's own page: full sentiment breakdown, topic pills, an AI-written
 * narrative when one exists, a membership trend across every filed period,
 * and the WhatsApp upload control. Reached from that group's snapshot card
 * on its Community tab — this is the "one click deeper" view, not primary
 * nav.
 */
export default async function GroupPage({
  params,
}: {
  params: Promise<{ community: string; slug: string }>;
}) {
  const { community: communitySlug, slug } = await params;
  const community = getCommunity(communitySlug);
  const group = getGroup(slug);
  // The group must exist AND belong to the community in the URL, so a mismatched
  // pair 404s rather than rendering a group under the wrong community's header.
  if (!community || !group || group.community !== community.slug) notFound();

  const data = await loadDashboard();
  const metrics = data.perGroup.find((m) => m.group === group.slug);
  if (!metrics) notFound();

  const series = groupPeriodSeries(data, group.slug);
  const groupWhatsappImports = data.imports.filter(
    (f) => f.source === 'whatsapp' && f.group === group.slug,
  );
  // The latest stored period's own ⚠-prefixed notes — surfaced at the top of
  // the page, not just inside the collapsed import panel further down, so a
  // successful-but-suspect upload doesn't read as silently fine.
  const latestImport = groupWhatsappImports
    .slice()
    .sort((a, b) => ((a.periodStart ?? '') < (b.periodStart ?? '') ? 1 : -1))[0] ?? null;
  const currentWarnings = latestImport ? splitNotes(latestImport.notes).warnings : [];

  const memberPoints = series.map((m) => ({
    week: m.periodEnd ? formatShortDate(m.periodEnd) : '',
    value: m.totalMembers,
  }));
  const messagePoints = series.map((m) => ({
    week: m.periodEnd ? formatShortDate(m.periodEnd) : '',
    value: m.messageCount,
  }));

  const periodLabel = metrics.periodStart && metrics.periodEnd
    ? formatDateRange(metrics.periodStart, metrics.periodEnd)
    : null;

  return (
    <>
      <PageHeader
        eyebrow={`${community.label} · ${community.groupNoun.replace(/s$/, '')}`}
        title={`${group.flag} ${group.label}`}
        titleAccessory={<ActivityBadge level={metrics.activityLevel} />}
        periodLabel={periodLabel}
      />

      <div className="content">
        {!metrics.hasWhatsapp ? (
          <div className="prefillNote" style={{ marginBottom: 18 }}>
            No WhatsApp report filed for {group.label} yet. Members, growth, messages, topics and
            sentiment below stay blank until you upload an export with a report date range — see
            “Import WhatsApp chat” below.
          </div>
        ) : null}

        {currentWarnings.length > 0 ? (
          <ul className="impRow__warnings" role="alert" style={{ marginBottom: 18 }}>
            <li style={{ fontWeight: 700 }}>Heads up about the latest WhatsApp import:</li>
            {currentWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}

        <TrendingTopic topic={metrics.mainTopics[0]} mentions={metrics.topTopicMentions} />

        <div className="grid grid--stats">
          <StatCard
            label="Members"
            value={formatExact(metrics.totalMembers)}
            delta={metrics.newMembers}
            deltaSuffix="vs previous report"
            accent
          >
            <Sparkline points={memberPoints} />
          </StatCard>

          <StatCardPercentDelta
            label="Member growth"
            value={formatPercent(metrics.memberGrowthPct)}
            hint={
              metrics.previousTotalMembers !== null
                ? `from ${formatExact(metrics.previousTotalMembers)} last report`
                : 'needs a previous report'
            }
          />

          <StatCard label="Messages this period" value={formatExact(metrics.messageCount)}>
            <Sparkline points={messagePoints} />
          </StatCard>

          <StatCard label="Unique active chatters" value={formatExact(metrics.uniqueActiveChatters)} />
        </div>

        <h2 className="sectionTitle">Members vs. previous report</h2>
        <MemberComparison
          currentMembers={metrics.totalMembers ?? 0}
          previousMembers={metrics.previousTotalMembers}
          previousLabel={
            metrics.previousPeriodStart && metrics.previousPeriodEnd
              ? formatDateRange(metrics.previousPeriodStart, metrics.previousPeriodEnd)
              : null
          }
        />

        {metrics.mainTopics.length > 0 ? (
          <section className="card" style={{ marginTop: 14 }}>
            <div className="card__head">
              <div className="card__title">Main topics discussed</div>
            </div>
            <div className="card__body">
              <div className="tagRow">
                {metrics.mainTopics.map((topic) => (
                  <span className="tag" key={topic}>
                    {topic}
                  </span>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {metrics.aiSummary?.narrative ? (
          <section className="card" style={{ marginTop: 14 }}>
            <div className="card__head">
              <div>
                <div className="card__title">What people are actually talking about</div>
                <div className="card__sub">
                  {group.label}{periodLabel ? ` · ${periodLabel}` : ''}
                </div>
              </div>
            </div>
            <div className="card__body">
              <div className="narrative">
                {metrics.aiSummary.narrative
                  .split('\n')
                  .filter((p) => p.trim() !== '')
                  .map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
              </div>
              <p className="aiNote">AI-generated from this period's chat export.</p>
            </div>
          </section>
        ) : null}

        {hasSentiment(metrics.sentiment) ? (
          <div style={{ marginTop: 14 }}>
            <SentimentPanel
              sentiment={metrics.sentiment}
              subtitle={`${group.label}${periodLabel ? ` · ${periodLabel}` : ''}`}
            />
          </div>
        ) : null}

        <h2 className="sectionTitle">Members · every filed report</h2>
        <section className="card">
          <div className="card__body">
            <SingleTrendChart points={memberPoints} seriesLabel="Members" unit="count" height={216} />
          </div>
        </section>

        <h2 className="sectionTitle">Import WhatsApp chat</h2>
        <WhatsappImportPanel
          group={group.slug}
          groupLabel={group.label}
          info={SOURCE_META.whatsapp}
          existing={groupWhatsappImports}
        />
      </div>
    </>
  );
}
