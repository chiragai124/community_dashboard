import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { SnapshotCard } from '@/components/SnapshotCard';
import { MemberComparison } from '@/components/MemberComparison';
import { NumberEntryForm } from '@/components/NumberEntryForm';
import { CommunityTopicsPanel } from '@/components/CommunityTopicsPanel';
import { CommunityWhatsappUpload } from '@/components/CommunityWhatsappUpload';
import { ImportPanel } from '@/components/ImportPanel';
import { ReportPeriodPicker } from '@/components/ReportPeriodPicker';
import {
  activityExtremes,
  communityLeads,
  communityMembers,
  communityTotals,
  groupsInCommunity,
  loadDashboard,
  previousCommunityLeads,
  previousCommunityMembers,
} from '@/lib/dashboard';
import { getCommunity, getGroup, importsFor, singularize } from '@/lib/groups';
import { SOURCE_META } from '@/lib/imports';
import { formatExact } from '@/lib/metrics';
import { formatDateRange } from '@/lib/period';
import { groqEnabled } from '@/lib/ai/groq';
import { getCommunitySummaries } from '@/lib/ai/store';

export const dynamic = 'force-dynamic';

/**
 * One community's tab: its headline figures for the reporting period, the two
 * numbers entered by hand for it (total members and leads added), the batch
 * chat-export upload, a snapshot card per group, and a community-wide topics
 * synthesis.
 *
 * The upload area takes every group's export at once and works out which is
 * which from the chats' own names — see components/CommunityWhatsappUpload.tsx.
 * Individual group pages keep a single-file upload for the rare export whose
 * name gives nothing away.
 */
export default async function CommunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ community: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { community: communitySlug } = await params;
  const { period: periodParam } = await searchParams;
  const community = getCommunity(communitySlug);
  if (!community) notFound();

  const data = await loadDashboard(periodParam);
  const perGroup = groupsInCommunity(data, community.slug);
  const totals = communityTotals(data, community.slug);
  const { busiest, quietest } = activityExtremes(perGroup);
  const maxMessages = Math.max(...perGroup.map((m) => m.messageCount ?? 0), 1);

  const busiestGroup = busiest ? getGroup(busiest.group) : null;
  const quietestGroup = quietest ? getGroup(quietest.group) : null;

  const memberEntry = communityMembers(data, community.slug);
  const previousMembers = previousCommunityMembers(data, community.slug);
  const leads = communityLeads(data, community.slug);
  const previousLeads = previousCommunityLeads(data, community.slug);

  const previousLabel = data.previous
    ? formatDateRange(data.previous.periodStart, data.previous.periodEnd)
    : null;

  // "Groups" reads as "Messages by groups" and "Groups snapshots"; both want
  // the singular, since they describe one of them each.
  const groupNounSingular = singularize(community.groupNoun);

  const summaries = await getCommunitySummaries();

  const whatsappImports = data.imports.filter(
    (f) => f.source === 'whatsapp' && f.community === community.slug,
  );
  // Short.io only — GA4 is landing-page traffic and lives on its own tab.
  const fileSources = importsFor(community.slug).map((source) => SOURCE_META[source]);

  const periodOptions = [...data.reports].reverse().map((report) => {
    const line = report.snapshot.communities.find((c) => c.community === community.slug);
    return {
      id: report.id,
      start: report.periodStart,
      end: report.periodEnd,
      filedLabel: line
        ? `${line.groupsWithEntry}/${line.groupCount} ${community.groupNoun.toLowerCase()} filed`
        : 'nothing filed',
    };
  });

  return (
    <>
      <PageHeader
        eyebrow={`${community.label} · Weekly report`}
        title={community.name}
        periodLabel={`${formatDateRange(data.period.start, data.period.end)}${
          memberEntry ? ` · ${formatExact(memberEntry.total)} members` : ''
        }`}
      />

      <div className="content">
        <ReportPeriodPicker
          period={data.period}
          activePeriod={data.activePeriod}
          isActivePeriod={data.isActivePeriod}
          options={periodOptions}
        />

        <CommunityWhatsappUpload
          community={community.slug}
          communityLabel={community.label}
          groupNoun={community.groupNoun}
          info={SOURCE_META.whatsapp}
          period={data.activePeriod}
          existing={whatsappImports}
        />

        {fileSources.length > 0 ? (
          <ImportPanel
            community={community.slug}
            scopeLabel={community.label}
            period={data.activePeriod}
            sources={fileSources}
            existing={data.imports.filter((f) => f.community === community.slug)}
          />
        ) : null}

        <div className="grid grid--stats">
          <StatCard label="Messages this period" value={formatExact(totals.messageCount)} />
          <StatCard
            label="Unique active chatters"
            value={formatExact(totals.uniqueActiveChatters)}
          />
          <StatCard
            label={`Most active ${groupNounSingular.toLowerCase()}: ${busiestGroup?.label ?? '—'}`}
            value={busiest ? formatExact(busiest.messageCount) : '—'}
          />
          <StatCard
            label={`Quietest ${groupNounSingular.toLowerCase()}: ${quietestGroup?.label ?? '—'}`}
            value={quietest ? formatExact(quietest.messageCount) : '—'}
          />
        </div>

        <h2 className="sectionTitle">Total members</h2>
        <NumberEntryForm
          subtitle="Entered by hand — kept as a dated history, so every report keeps its own figure."
          valueLabel="Total members"
          endpoint="/api/community-members"
          valueField="total"
          extraPayload={{ community: community.slug }}
          currentValue={memberEntry?.total ?? null}
          period={data.activePeriod}
          placeholder="e.g. 1904"
        />

        <h2 className="sectionTitle">Members vs. previous report</h2>
        <MemberComparison
          currentMembers={memberEntry?.total ?? 0}
          previousMembers={previousMembers}
          previousLabel={previousLabel}
        />

        <h2 className="sectionTitle">Leads added to CRM</h2>
        <NumberEntryForm
          subtitle="How many leads this community added to the CRM during the reporting period."
          valueLabel="Leads added"
          endpoint="/api/community-leads"
          valueField="leads"
          currentValue={leads}
          extraPayload={{ community: community.slug }}
          period={data.activePeriod}
        />
        {leads !== null ? (
          <p className="chartNote">
            {formatExact(leads)} lead{leads === 1 ? '' : 's'} this period
            {previousLeads !== null && previousLabel
              ? ` · ${formatExact(previousLeads)} at ${previousLabel}`
              : ''}
            . This feeds the follow-up funnel on the Overview tab.
          </p>
        ) : null}

        <h2 className="sectionTitle">Messages by {groupNounSingular.toLowerCase()}</h2>
        <section className="card">
          <div className="card__body">
            <div className="bars">
              {perGroup.map((m) => {
                const group = getGroup(m.group);
                const value = m.messageCount ?? 0;
                return (
                  <div className="bar-row" key={m.group}>
                    <div className="bar-row__top">
                      <span className="bar-row__label">
                        <span aria-hidden="true">{group?.flag}</span> {group?.label}
                      </span>
                      <span className="bar-row__value">
                        {m.hasWhatsapp ? formatExact(value) : <span className="muted">not filed</span>}
                      </span>
                    </div>
                    <div
                      className="bar-track"
                      role="img"
                      aria-label={`${group?.label}: ${
                        m.hasWhatsapp ? `${formatExact(value)} messages` : 'no export filed'
                      }`}
                    >
                      <div
                        className={`bar-fill${m.group === busiest?.group ? ' bar-fill--lead' : ''}`}
                        style={{ width: `${Math.max((value / maxMessages) * 100, 2)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {totals.groupsWithEntry === 0 ? (
              <p className="chartNote">
                No chat exports filed for this period — drop {community.label}&rsquo;s exports into
                the import panel above.
              </p>
            ) : totals.groupsWithEntry < totals.groupCount ? (
              <p className="chartNote">
                {totals.groupsWithEntry} of {totals.groupCount}{' '}
                {community.groupNoun.toLowerCase()} have an export filed for this period.
              </p>
            ) : null}
          </div>
        </section>

        <h2 className="sectionTitle">{groupNounSingular} snapshots</h2>
        <div className="grid grid--snapshots">
          {perGroup.map((metrics) => (
            <SnapshotCard key={metrics.group} metrics={metrics} />
          ))}
        </div>

        <CommunityTopicsPanel
          community={community.slug}
          summary={summaries[community.slug] ?? null}
          groqAvailable={groqEnabled()}
        />
      </div>
    </>
  );
}
