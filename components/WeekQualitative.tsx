import type { WeeklyEntry } from '@/lib/types';

/**
 * The week's qualitative notes — common student questions, how students responded
 * to content, and why the activity level is what it is.
 *
 * MAIN TOPICS ARE NOT HERE. They are rendered always-visible by <GroupTopics>,
 * because "what was this channel talking about" is the question a card is most
 * often opened to answer, and burying it behind a click made it invisible in
 * practice. Everything below is genuinely secondary and stays collapsed.
 *
 * Collapsed by default via native <details>, so the card and detail page stay
 * compact and nothing here needs client JavaScript. Renders nothing at all when
 * the week has none of these filled in — an empty expander is just clutter.
 *
 * On a group card this MUST be rendered outside the card's <a>: a <summary>
 * inside an anchor is invalid HTML, and clicking it would navigate instead of
 * expanding.
 */

export function hasQualitative(entry: WeeklyEntry | null | undefined): boolean {
  if (!entry) return false;
  return (
    entry.commonQuestions.length > 0 ||
    entry.contentResponse.trim() !== '' ||
    entry.activityNote.trim() !== ''
  );
}

/** Count of filled fields, shown on the summary so the value is visible closed. */
function filledCount(entry: WeeklyEntry): number {
  return [
    entry.commonQuestions.length > 0,
    entry.contentResponse.trim() !== '',
    entry.activityNote.trim() !== '',
  ].filter(Boolean).length;
}

/**
 * Main topics, always visible. `variant` picks the padding: "card" sits inside a
 * group card, "panel" inside a detail-page section.
 */
export function GroupTopics({
  entry,
  variant = 'card',
  label = 'Topics this week',
}: {
  entry: WeeklyEntry | null | undefined;
  variant?: 'card' | 'panel';
  label?: string;
}) {
  if (!entry || entry.mainTopics.length === 0) return null;

  if (variant === 'panel') {
    return (
      <div className="qual__field">
        <div className="qual__fieldLabel">{label}</div>
        <div className="tagRow">
          {entry.mainTopics.map((topic) => (
            <span className="tag" key={topic}>
              {topic}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="groupCard__topicsLabel">{label}</div>
      <div className="groupCard__topics">
        {entry.mainTopics.map((topic) => (
          <span className="tag" key={topic}>
            {topic}
          </span>
        ))}
      </div>
    </>
  );
}

export function WeekQualitative({
  entry,
  /** "card" is the tighter variant used inside a group card. */
  variant = 'card',
  label = 'Week notes',
}: {
  entry: WeeklyEntry | null | undefined;
  variant?: 'card' | 'panel';
  label?: string;
}) {
  if (!hasQualitative(entry) || !entry) return null;

  const count = filledCount(entry);

  return (
    <details className={`qual qual--${variant}`}>
      <summary className="qual__summary">
        <span className="qual__chevron" aria-hidden="true">
          ▸
        </span>
        <span className="qual__summaryLabel">{label}</span>
        <span className="qual__summaryHint">
          {count} note{count === 1 ? '' : 's'}
        </span>
      </summary>

      <div className="qual__body">
        {entry.commonQuestions.length > 0 ? (
          <div className="qual__field">
            <div className="qual__fieldLabel">Common student questions</div>
            <ul className="qual__list">
              {entry.commonQuestions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {entry.contentResponse.trim() !== '' ? (
          <div className="qual__field">
            <div className="qual__fieldLabel">Content response</div>
            <p className="qual__text">{entry.contentResponse}</p>
          </div>
        ) : null}

        {entry.activityNote.trim() !== '' ? (
          <div className="qual__field">
            <div className="qual__fieldLabel">
              Activity note <span className="qual__inline">({entry.activityLevel})</span>
            </div>
            <p className="qual__text">{entry.activityNote}</p>
          </div>
        ) : null}
      </div>
    </details>
  );
}
