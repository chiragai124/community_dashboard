/**
 * The week's single most-discussed topic, called out on its own — separate
 * from <GroupTopics>'s full list further down the page. Same underlying
 * detection (lib/imports/whatsapp.ts's word-frequency heuristic over this
 * week's WhatsApp messages): `mainTopics` is already ranked most-mentioned
 * first, so this is just `mainTopics[0]` given its own prominent treatment,
 * not a second computation.
 *
 * Renders nothing when there's no WhatsApp data for the week to detect a
 * topic from — an empty highlighted box would read as a broken feature, not
 * an honest "nothing yet".
 */
export function TrendingTopic({
  topic,
  mentions,
}: {
  topic: string | null | undefined;
  mentions: number | null;
}) {
  if (!topic) return null;

  return (
    <section className="trendingTopic">
      <span className="trendingTopic__label">Trending topic this week</span>
      <span className="trendingTopic__value">{topic}</span>
      <span className="trendingTopic__hint">
        The week's most-discussed topic in the group's WhatsApp messages
        {mentions !== null ? ` — mentioned ${mentions} time${mentions === 1 ? '' : 's'}` : ''}.
      </span>
    </section>
  );
}
