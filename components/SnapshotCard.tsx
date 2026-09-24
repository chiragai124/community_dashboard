import Link from 'next/link';
import type { GroupPeriodMetrics } from '@/lib/types';
import { getGroup } from '@/lib/groups';
import { formatExact } from '@/lib/metrics';

/** Which of the three status-pill styles a tag reads as, by simple keyword match. */
function healthClass(tag: string, activityLevel: string | null): 'hot' | 'quiet' | 'ok' {
  const t = tag.toLowerCase();
  if (t.includes('most active') || t.includes('high') || t.includes('very active') || activityLevel === 'High') {
    return 'hot';
  }
  if (t.includes('silent') || t.includes('quiet') || t.includes('low') || activityLevel === 'Low') {
    return 'quiet';
  }
  return 'ok';
}

/**
 * One group's snapshot, shown in a grid on its Community tab: status tag,
 * messages, active chatters, and top voices. Kept lean — topics and the
 * narrative are synthesised once per community instead (see
 * CommunityTopicsPanel) rather than repeated on every card. Links through to
 * the group's own page for the full sentiment breakdown and the WhatsApp
 * upload control.
 *
 * `periodParam` is passed through to that link when a past report is being
 * browsed. Without it, clicking into a group from a past report silently
 * lands on the *current* period's figures under the same-looking page —
 * exactly the "which dates am I looking at" confusion the single reporting
 * period exists to remove.
 */
export function SnapshotCard({
  metrics,
  periodParam,
}: {
  metrics: GroupPeriodMetrics;
  /** `start:end` of the period being viewed, when it isn't the active one. */
  periodParam?: string | null;
}) {
  const group = getGroup(metrics.group);
  if (!group) return null;

  const tag = metrics.aiSummary?.statusTag ?? metrics.activityLevel ?? 'No data';
  const health = healthClass(tag, metrics.activityLevel);
  const href =
    `/c/${group.community}/group/${group.slug}` +
    (periodParam ? `?period=${encodeURIComponent(periodParam)}` : '');

  const voicesLine =
    metrics.topVoices.length === 0
      ? null
      : metrics.aiSummary?.topVoicesSummary ||
        `${metrics.topVoices.length === 1 ? 'Top voice' : 'Top voices'}: ` +
          metrics.topVoices.map((v) => `${v.name} (${v.count})`).join(', ');

  return (
    <article className="snapshotCard">
      <div className="snapshotCard__head">
        <span className="snapshotCard__flag" aria-hidden="true">
          {group.flag}
        </span>
        <span className="snapshotCard__name">{group.label}</span>
        <span className={`healthTag healthTag--${health}`}>{tag}</span>
      </div>

      <div className="snapshotCard__body">
        <div className="snapshotCard__kv">
          <span className="snapshotCard__kvLabel">Messages</span>
          <span className="snapshotCard__kvVal">{formatExact(metrics.messageCount)}</span>
        </div>
        <div className="snapshotCard__kv">
          <span className="snapshotCard__kvLabel">Active chatters</span>
          <span className="snapshotCard__kvVal">{formatExact(metrics.uniqueActiveChatters)}</span>
        </div>

        {voicesLine ? <div className="snapshotCard__voices">{voicesLine}</div> : null}
      </div>

      <Link href={href} className="snapshotCard__foot">
        {metrics.hasWhatsapp ? 'Full sentiment & topics' : 'Upload this report'}
        <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}
