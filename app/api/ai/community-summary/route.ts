import { NextResponse } from 'next/server';
import { generateCommunitySummary, groqEnabled } from '@/lib/ai/groq';
import { saveCommunitySummary } from '@/lib/ai/store';
import { getImports, latestGroupPeriod } from '@/lib/imports';
import { getCommunity, groupsOf, isCommunitySlug } from '@/lib/groups';

// The Groq call here can run long enough to exceed Vercel's default (10s on
// Hobby) function timeout — see app/api/imports/route.ts's maxDuration.
export const maxDuration = 60;

/**
 * POST { community } — regenerate the "Main Topics Discussed" pill list and
 * narrative for one community, synthesised from its groups' latest filed
 * periods. Manual, not automatic: a community's report only fully settles
 * once every one of its groups has been filed for the current cycle.
 */
export async function POST(request: Request) {
  if (!groqEnabled()) {
    return NextResponse.json(
      { error: 'GROQ_API_KEY is not configured, so AI summaries are unavailable.' },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { community?: string };
  if (!isCommunitySlug(body.community)) {
    return NextResponse.json({ error: 'Unknown community.' }, { status: 400 });
  }
  const community = getCommunity(body.community)!;

  const imports = await getImports();
  const groups = groupsOf(community.slug)
    .map((g) => {
      const latest = latestGroupPeriod(imports, g.slug);
      if (!latest?.whatsapp) return null;
      return {
        groupLabel: g.label,
        statusTag: latest.aiSummary?.statusTag ?? latest.whatsapp.activityLevel,
        messageCount: latest.whatsapp.messageCount,
        mainTopics: latest.whatsapp.mainTopics,
        narrative: latest.aiSummary?.narrative ?? '',
      };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null);

  if (groups.length === 0) {
    return NextResponse.json(
      { error: 'No reports filed for this community yet.' },
      { status: 400 },
    );
  }

  const summary = await generateCommunitySummary(community.label, groups);
  if (!summary) {
    return NextResponse.json({ error: 'The AI summary call failed or returned nothing usable.' }, { status: 502 });
  }

  await saveCommunitySummary(community.slug, { ...summary, generatedAt: new Date().toISOString() });
  return NextResponse.json({ ok: true, summary });
}
