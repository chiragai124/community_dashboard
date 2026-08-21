import { NextResponse } from 'next/server';
import { generateOverviewTakeaways, groqEnabled } from '@/lib/ai/groq';
import { saveOverviewTakeaways } from '@/lib/ai/store';
import { getImports, latestGroupPeriod } from '@/lib/imports';
import { COMMUNITIES, groupsOf } from '@/lib/groups';

/**
 * POST — regenerate the Overview page's "Headline Takeaways" from every
 * community's groups' latest filed periods. Manual, not automatic: this
 * spans all three communities' worth of groups, and firing it on every
 * Overview page load would be an unbounded number of Groq calls.
 */
export async function POST() {
  if (!groqEnabled()) {
    return NextResponse.json(
      { error: 'GROQ_API_KEY is not configured, so AI summaries are unavailable.' },
      { status: 400 },
    );
  }

  const imports = await getImports();

  const communities = COMMUNITIES.map((community) => {
    const groups = groupsOf(community.slug)
      .map((g) => {
        const latest = latestGroupPeriod(imports, g.slug);
        if (!latest?.whatsapp) return null;
        return {
          groupLabel: g.label,
          statusTag: latest.aiSummary?.statusTag ?? latest.whatsapp.activityLevel,
          narrative: latest.aiSummary?.narrative ?? '',
        };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);
    const memberCount = groupsOf(community.slug).reduce((sum, g) => {
      const latest = latestGroupPeriod(imports, g.slug);
      return sum + (latest?.whatsapp?.totalMembers ?? 0);
    }, 0);
    const messageCount = groups.length === 0
      ? 0
      : groupsOf(community.slug).reduce((sum, g) => {
          const latest = latestGroupPeriod(imports, g.slug);
          return sum + (latest?.whatsapp?.messageCount ?? 0);
        }, 0);
    return { communityLabel: community.label, memberCount, messageCount, groupSummaries: groups };
  });

  const takeaways = await generateOverviewTakeaways(communities);
  if (!takeaways || takeaways.length === 0) {
    return NextResponse.json(
      { error: 'The AI summary call failed, returned nothing usable, or no reports are filed yet.' },
      { status: 502 },
    );
  }

  await saveOverviewTakeaways(takeaways);
  return NextResponse.json({ ok: true, takeaways });
}
