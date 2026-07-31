import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { LeadBreakdownBars } from '@/components/LeadBreakdownBars';
import { LeadEntryForm } from '@/components/LeadEntryForm';
import { SingleTrendChart } from '@/components/charts';
import { getCommunity, groupLabel, groupsOf } from '@/lib/groups';
import { entryWeekOptions, loadDashboard } from '@/lib/dashboard';
import { leadBreakdown, leadTotals, leadsForGroups, leadsPerWeek } from '@/lib/leads';
import { formatExact } from '@/lib/metrics';
import { formatWeekRange } from '@/lib/weeks';

export const dynamic = 'force-dynamic';

/**
 * The leads funnel for one community: how many, arriving at what rate, and split
 * by university and by country.
 *
 * Every figure here comes from hand-entered leads — there is no registrations
 * import. The most recent leads are listed at the bottom so a mistyped row can be
 * spotted, but the list is deliberately short: this page is for the shape of the
 * pipeline, not for browsing personal records.
 */
export default async function CommunityLeadsPage({
  params,
}: {
  params: Promise<{ community: string }>;
}) {
  const { community: communitySlug } = await params;
  const community = getCommunity(communitySlug);
  if (!community) notFound();

  const data = await loadDashboard();
  const groups = groupsOf(community.slug);
  const leads = leadsForGroups(data.leads, groups.map((g) => g.slug));

  const totals = leadTotals(leads, data.displayWeek);
  const byUniversity = leadBreakdown(leads, 'university');
  const byCountry = leadBreakdown(leads, 'country');
  const perWeek = leadsPerWeek(leads, data.weeks);
  const recent = leads.slice(0, 15);

  const noun = community.groupNoun.toLowerCase();

  return (
    <>
      <PageHeader
        eyebrow={`${community.label} · Leads`}
        title="Leads funnel"
        weekStart={data.displayWeek}
      />

      <div className="content">
        {totals.total === 0 ? (
          <div className="prefillNote" style={{ marginBottom: 18 }}>
            No leads recorded for {community.label} yet. Add one below, or paste a block
            straight from a spreadsheet.
          </div>
        ) : null}

        <div className="grid grid--stats">
          <StatCard
            label="Total leads"
            value={formatExact(totals.total)}
            hint={`across ${noun} in ${community.label}`}
            accent
          />
          <StatCard
            label="Leads this week"
            value={formatExact(totals.thisWeek)}
            hint={formatWeekRange(data.displayWeek)}
          />
          <StatCard
            label="Universities"
            value={formatExact(totals.universities)}
            hint="distinct, where recorded"
          />
          <StatCard
            label="Countries"
            value={formatExact(totals.countries)}
            hint="distinct, where recorded"
          />
        </div>

        {totals.total > 0 ? (
          <>
            <section className="card" style={{ marginTop: 14 }}>
              <div className="card__head">
                <div>
                  <div className="card__title">Leads per week · last {perWeek.length} weeks</div>
                  <div className="card__sub">
                    Counted by the week each lead was filed under
                  </div>
                </div>
              </div>
              <div className="card__body">
                <SingleTrendChart
                  points={perWeek}
                  seriesLabel="Leads"
                  unit="count"
                  height={216}
                  wash
                />
              </div>
            </section>

            <div className="grid grid--halves" style={{ marginTop: 14 }}>
              <LeadBreakdownBars
                title="By university"
                subtitle={`Top ${byUniversity.length} of ${totals.universities}`}
                rows={byUniversity}
                missing={totals.missingUniversity}
                missingLabel="no university recorded"
                emptyHint="No universities recorded yet."
              />
              <LeadBreakdownBars
                title="By country"
                subtitle={`Top ${byCountry.length} of ${totals.countries}`}
                rows={byCountry}
                missing={totals.missingCountry}
                missingLabel="no country recorded"
                emptyHint="No countries recorded yet."
              />
            </div>

            <h2 className="sectionTitle">Most recent leads</h2>
            <section className="card">
              <div className="tableWrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Phone</th>
                      <th>University</th>
                      <th>Country</th>
                      <th>Group</th>
                      <th>Week</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((lead) => (
                      <tr key={lead.id}>
                        <td className="tableLead">{lead.name || '—'}</td>
                        <td className={lead.email ? '' : 'leadTable__cell--muted'}>
                          {lead.email || '—'}
                        </td>
                        <td className={lead.phone ? '' : 'leadTable__cell--muted'}>
                          {lead.phone || '—'}
                        </td>
                        <td className={lead.university ? '' : 'leadTable__cell--muted'}>
                          {lead.university || '—'}
                        </td>
                        <td className={lead.country ? '' : 'leadTable__cell--muted'}>
                          {lead.country || '—'}
                        </td>
                        <td>{groupLabel(lead.group)}</td>
                        <td>{formatWeekRange(lead.weekStart)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="tableFoot">
                Showing {recent.length} of {formatExact(totals.total)}. Stored locally in
                data/leads.json — personal data, never sent anywhere.
              </div>
            </section>
          </>
        ) : null}

        <h2 className="sectionTitle">Add leads</h2>
        <section className="card">
          <div className="card__head">
            <div>
              <div className="card__title">New lead</div>
              <div className="card__sub">
                One at a time, or paste a block from a spreadsheet
              </div>
            </div>
          </div>
          <div className="card__body">
            <LeadEntryForm
              groups={groups}
              weekOptions={entryWeekOptions()}
              defaultWeek={data.displayWeek}
              defaultGroup={groups[0].slug}
            />
          </div>
        </section>
      </div>
    </>
  );
}
