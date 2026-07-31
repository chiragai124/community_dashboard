import type { CommonQuestion, TopicTerm } from '@/lib/types';
import { formatExact } from '@/lib/metrics';

/**
 * Topics and questions, read out of the chat export.
 *
 * Both are frequency-based, and the wording is careful about that: these are the
 * words and questions that recurred, not a summary of what the conversation meant.
 * A reader acting on "guarantor · 14 messages" should know it is a count.
 *
 * Topics are always visible; there is no expander. They answer the question a
 * group card is most often opened for, and burying them behind a click made them
 * invisible in practice.
 */

export function hasChatInsights(topics: TopicTerm[], questions: CommonQuestion[]): boolean {
  return topics.length > 0 || questions.length > 0;
}

/** Topic chips with their message counts. `variant` picks the padding. */
export function GroupTopics({
  topics,
  variant = 'card',
  label = 'Topics this week',
  limit = 6,
}: {
  topics: TopicTerm[];
  variant?: 'card' | 'panel';
  label?: string;
  limit?: number;
}) {
  if (topics.length === 0) return null;
  const shown = topics.slice(0, limit);

  const chips = shown.map((topic) => (
    <span className="tag" key={topic.term} title={`${topic.messages} messages used this`}>
      {topic.term}
      <span className="tag__count"> {topic.messages}</span>
    </span>
  ));

  if (variant === 'panel') {
    return (
      <div className="qual__field">
        <div className="qual__fieldLabel">{label}</div>
        <div className="tagRow">{chips}</div>
      </div>
    );
  }

  return (
    <>
      <div className="groupCard__topicsLabel">{label}</div>
      <div className="groupCard__topics">{chips}</div>
    </>
  );
}

/** The questions students actually asked, most-asked first. */
export function CommonQuestions({
  questions,
  title = 'What students asked',
  subtitle,
}: {
  questions: CommonQuestion[];
  title?: string;
  subtitle: string;
}) {
  if (questions.length === 0) return null;

  return (
    <section className="card">
      <div className="card__head">
        <div>
          <div className="card__title">{title}</div>
          <div className="card__sub">{subtitle}</div>
        </div>
      </div>
      <div className="card__body">
        <ul className="qual__list">
          {questions.map((question) => (
            <li key={question.text}>
              {question.text}
              {question.asked > 1 ? (
                <span className="muted"> · asked {formatExact(question.asked)}×</span>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="chartNote">
          Messages containing a question mark, grouped by near-duplicate. The shortest
          phrasing of each is shown.
        </p>
      </div>
    </section>
  );
}
