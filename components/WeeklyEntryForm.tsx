'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { GroupSlug, Poll, WeeklyEntry } from '@/lib/types';
import { formatPercent } from '@/lib/metrics';
import { formatWeekRange, isoWeekNumber } from '@/lib/weeks';

/**
 * The last hand-typed form in the dashboard: poll responses and DM figures.
 *
 * Everything else — members, growth, join source, activity, topics, questions,
 * sentiment — now comes from the chat export. These three remain because no
 * export contains them: WhatsApp exports carry a poll's question but never its
 * votes, and a group export contains no 1:1 threads at all.
 *
 * `members` comes in from the chat import purely to show the response rate live
 * as you type. It is never editable here.
 */

interface FormPoll {
  question: string;
  options: { label: string; count: string }[];
}

const EMPTY_POLL: FormPoll = {
  question: '',
  options: [
    { label: '', count: '' },
    { label: '', count: '' },
  ],
};

function toFormPolls(polls: Poll[]): FormPoll[] {
  if (polls.length === 0) return [structuredClone(EMPTY_POLL)];
  return polls.map((poll) => ({
    question: poll.question,
    options:
      poll.options.length > 0
        ? poll.options.map((o) => ({ label: o.label, count: String(o.count) }))
        : [...EMPTY_POLL.options],
  }));
}

function num(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function WeeklyEntryForm({
  group,
  groupLabel,
  weekOptions,
  entries,
  defaultWeek,
  membersByWeek,
}: {
  group: GroupSlug;
  groupLabel: string;
  weekOptions: string[];
  entries: WeeklyEntry[];
  defaultWeek: string;
  /** Member count per week, from the chat export. Read-only context. */
  membersByWeek: Record<string, number | null>;
}) {
  const router = useRouter();
  const [weekStart, setWeekStart] = useState(defaultWeek);

  const existing = useMemo(
    () => entries.find((e) => e.weekStart === weekStart) ?? null,
    [entries, weekStart],
  );
  const previous = useMemo(
    () =>
      [...entries]
        .filter((e) => e.weekStart < weekStart)
        .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))[0] ?? null,
    [entries, weekStart],
  );

  const [dmsSent, setDmsSent] = useState('');
  const [dmReplies, setDmReplies] = useState('');
  const [polls, setPolls] = useState<FormPoll[]>([structuredClone(EMPTY_POLL)]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Load the selected week. Deliberately does NOT clear `message`: saving calls
  // router.refresh(), which makes `existing` appear and re-runs this effect —
  // clearing here would wipe the "Saved" confirmation. The week picker clears it.
  useEffect(() => {
    if (existing) {
      setDmsSent(String(existing.dmsSent));
      setDmReplies(String(existing.dmReplies));
      setPolls(toFormPolls(existing.polls));
      return;
    }
    // Nothing carries over: a stale DM count would silently become a wrong data
    // point, and last week's poll is not this week's poll.
    setDmsSent('');
    setDmReplies('');
    setPolls([structuredClone(EMPTY_POLL)]);
  }, [existing, weekStart]);

  const members = membersByWeek[weekStart] ?? null;
  const pollResponseTotal = polls.reduce(
    (sum, poll) => sum + poll.options.reduce((s, o) => s + (num(o.count) ?? 0), 0),
    0,
  );
  const pollRate =
    members !== null && members > 0 ? (pollResponseTotal / members) * 100 : null;

  const dmsSentNum = num(dmsSent);
  const dmRepliesNum = num(dmReplies);
  const dmRate =
    dmsSentNum && dmsSentNum > 0 && dmRepliesNum !== null
      ? (dmRepliesNum / dmsSentNum) * 100
      : null;

  function updatePoll(index: number, patch: Partial<FormPoll>) {
    setPolls((current) => current.map((poll, i) => (i === index ? { ...poll, ...patch } : poll)));
  }

  function updateOption(
    pollIndex: number,
    optionIndex: number,
    patch: Partial<{ label: string; count: string }>,
  ) {
    setPolls((current) =>
      current.map((poll, i) =>
        i === pollIndex
          ? {
              ...poll,
              options: poll.options.map((option, j) =>
                j === optionIndex ? { ...option, ...patch } : option,
              ),
            }
          : poll,
      ),
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);

    if (dmRepliesNum !== null && dmsSentNum !== null && dmRepliesNum > dmsSentNum) {
      setMessage({ kind: 'err', text: 'DM replies cannot exceed DMs sent.' });
      return;
    }

    const payloadPolls: Poll[] = polls
      .map((poll) => ({
        question: poll.question.trim(),
        options: poll.options
          .map((o) => ({ label: o.label.trim(), count: num(o.count) ?? 0 }))
          .filter((o) => o.label !== ''),
      }))
      .filter((poll) => poll.question !== '');

    setSaving(true);
    try {
      const res = await fetch('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group,
          weekStart,
          polls: payloadPolls,
          dmsSent: dmsSentNum ?? 0,
          dmReplies: dmRepliesNum ?? 0,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Save failed (${res.status})`);
      }
      setMessage({ kind: 'ok', text: `Saved ${groupLabel} · W${isoWeekNumber(weekStart)}.` });
      router.refresh();
    } catch (err) {
      setMessage({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Save failed.',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="prefillNote">
        {existing ? (
          <>
            Editing the saved entry for <strong>{formatWeekRange(weekStart)}</strong>. Saving
            overwrites it.
          </>
        ) : (
          <>
            Polls and DMs only — these are the two things no export contains. Members,
            growth, topics and sentiment all come from the chat import.
          </>
        )}
      </div>

      <div className="formGrid">
        <div className="field">
          <label className="field__label" htmlFor="entry-week">
            Week
          </label>
          <select
            id="entry-week"
            value={weekStart}
            onChange={(e) => {
              setMessage(null);
              setWeekStart(e.target.value);
            }}
          >
            {weekOptions.map((week) => (
              <option key={week} value={week}>
                W{isoWeekNumber(week)} · {formatWeekRange(week)}
              </option>
            ))}
          </select>
          <span className="field__computed">
            {members !== null
              ? `${members.toLocaleString('en-US')} members (from the export)`
              : 'no chat export covers this week'}
          </span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="entry-dms">
            1:1 DMs sent
          </label>
          <input
            id="entry-dms"
            type="number"
            min="0"
            inputMode="numeric"
            value={dmsSent}
            onChange={(e) => setDmsSent(e.target.value)}
            placeholder={previous ? String(previous.dmsSent) : '—'}
          />
          <span className="field__computed">
            {previous ? `last week: ${previous.dmsSent}` : ' '}
          </span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="entry-dm-replies">
            DM replies
          </label>
          <input
            id="entry-dm-replies"
            type="number"
            min="0"
            inputMode="numeric"
            value={dmReplies}
            onChange={(e) => setDmReplies(e.target.value)}
            placeholder={previous ? String(previous.dmReplies) : '—'}
          />
          <span className="field__computed">
            {dmRate !== null ? `${formatPercent(dmRate)} reply rate` : ' '}
          </span>
        </div>
      </div>

      <div>
        <div className="rowBetween" style={{ marginBottom: 9 }}>
          <span className="field__label">
            Polls this week
            <span className="field__hint">
              {pollResponseTotal > 0
                ? `${pollResponseTotal} responses${pollRate !== null ? ` · ${formatPercent(pollRate)} of members` : ''}`
                : 'the export has the question but not the votes — copy the counts from WhatsApp'}
            </span>
          </span>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setPolls((c) => [...c, structuredClone(EMPTY_POLL)])}
          >
            + Add poll
          </button>
        </div>

        {polls.map((poll, pollIndex) => (
          <fieldset className="fieldset" key={pollIndex} style={{ marginBottom: 12 }}>
            <legend className="fieldset__legend">
              Poll {pollIndex + 1}
              {polls.length > 1 ? (
                <button
                  type="button"
                  className="iconBtn"
                  onClick={() => setPolls((c) => c.filter((_, i) => i !== pollIndex))}
                  aria-label={`Remove poll ${pollIndex + 1}`}
                >
                  ×
                </button>
              ) : null}
            </legend>

            <div className="field" style={{ marginBottom: 10 }}>
              <label className="field__label" htmlFor={`poll-${pollIndex}-q`}>
                Question
              </label>
              <input
                id={`poll-${pollIndex}-q`}
                type="text"
                value={poll.question}
                onChange={(e) => updatePoll(pollIndex, { question: e.target.value })}
                placeholder="What stage of your housing search are you at?"
              />
            </div>

            {poll.options.map((option, optionIndex) => (
              <div className="optionRow" key={optionIndex}>
                <input
                  className="optionRow__label"
                  type="text"
                  value={option.label}
                  onChange={(e) => updateOption(pollIndex, optionIndex, { label: e.target.value })}
                  placeholder={`Option ${optionIndex + 1}`}
                  aria-label={`Poll ${pollIndex + 1} option ${optionIndex + 1} label`}
                />
                <input
                  className="optionRow__count"
                  type="number"
                  min="0"
                  value={option.count}
                  onChange={(e) => updateOption(pollIndex, optionIndex, { count: e.target.value })}
                  placeholder="0"
                  aria-label={`Poll ${pollIndex + 1} option ${optionIndex + 1} responses`}
                />
                {poll.options.length > 2 ? (
                  <button
                    type="button"
                    className="optionRow__remove"
                    onClick={() =>
                      updatePoll(pollIndex, {
                        options: poll.options.filter((_, j) => j !== optionIndex),
                      })
                    }
                    aria-label="Remove option"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ))}

            <button
              type="button"
              className="btn btn--sm"
              onClick={() =>
                updatePoll(pollIndex, { options: [...poll.options, { label: '', count: '' }] })
              }
            >
              + Option
            </button>
          </fieldset>
        ))}
      </div>

      <div className="formFoot">
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? 'Saving…' : existing ? 'Update week' : 'Save week'}
        </button>
        {message ? (
          <span
            className={`formMsg formMsg--${message.kind === 'ok' ? 'ok' : 'err'}`}
            role={message.kind === 'err' ? 'alert' : 'status'}
          >
            {message.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}
