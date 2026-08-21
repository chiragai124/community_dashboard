import type { CommunitySlug, CommunitySummary } from '@/lib/types';
import { formatRelativeTime } from '@/lib/metrics';
import { RegenerateButton } from './RegenerateButton';

/**
 * "Main Topics Discussed" + "What people are actually talking about" for a
 * whole community — synthesised once across its groups (see
 * lib/ai/groq.ts's generateCommunitySummary), not repeated per group card.
 * Regenerated on demand rather than automatically: a community's report only
 * fully settles once every one of its groups has been filed.
 */
export function CommunityTopicsPanel({
  community,
  summary,
  groqAvailable,
}: {
  community: CommunitySlug;
  summary: CommunitySummary | null;
  groqAvailable: boolean;
}) {
  return (
    <>
      <h2 className="sectionTitle">Main topics discussed</h2>
      <section className="card">
        <div className="card__body">
          {summary && summary.mainTopics.length > 0 ? (
            <div className="tagRow">
              {summary.mainTopics.map((topic) => (
                <span className="tag" key={topic}>
                  {topic}
                </span>
              ))}
            </div>
          ) : (
            <p className="chartNote" style={{ margin: 0 }}>
              Not generated yet — see below.
            </p>
          )}
        </div>
      </section>

      <h2 className="sectionTitle">What people are actually talking about</h2>
      <section className="card">
        <div className="card__body">
          {summary?.narrative ? (
            <div className="narrative">
              {summary.narrative
                .split('\n')
                .filter((p) => p.trim() !== '')
                .map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
            </div>
          ) : (
            <p className="chartNote" style={{ margin: 0 }}>
              {groqAvailable
                ? 'Not generated yet for this period.'
                : 'GROQ_API_KEY is not configured, so this can\'t be generated.'}
            </p>
          )}
          {groqAvailable ? (
            <div style={{ marginTop: 12 }}>
              <RegenerateButton
                endpoint="/api/ai/community-summary"
                body={{ community }}
                label={summary ? 'Regenerate' : 'Generate with AI'}
              />
            </div>
          ) : null}
          {summary?.generatedAt ? (
            <p className="aiNote">Last generated {formatRelativeTime(summary.generatedAt)}.</p>
          ) : null}
        </div>
      </section>
    </>
  );
}
