'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ActivityLevel, GroupSlug, Poll, WeeklyEntry } from '@/lib/types';
import { formatPercent, formatSigned, formatSignedPercent } from '@/lib/metrics';
import { formatWeekRange, isoWeekNumber } from '@/lib/weeks';

/**
 * The manual weekly entry form — the only place data is typed by hand, so it is
 * built for speed:
 *
 *  • Member count is pre-filled with last week's number, so the user edits only
 *    the delta.
 *  • New members are derived from that delta automatically; the field is there
 *    purely to override it when the count came from somewhere else.
 *  • Activity level defaults to last week's choice.
 *  • DMs show last week's volume as placeholder text rather than pre-filling it,
 *    since a stale DM count would silently become a wrong data point.
 *  • Every derived rate updates live as you type, so mistakes are obvious before
 *    saving.
 *  • Switching weeks needs no round-trip: this group's entries are already here.
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

/** Split a comma- or newline-separated field into trimmed, non-empty items. */
function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
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
}: {
  group: GroupSlug;
  groupLabel: string;
  /** Selectable weeks, newest first. */
  weekOptions: string[];
  /** Every stored entry for this group, so week switching is instant. */
  entries: WeeklyEntry[];
  defaultWeek: string;
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

  const [totalMembers, setTotalMembers] = useState('');
  const [newMembersOverride, setNewMembersOverride] = useState('');
  const [dmsSent, setDmsSent] = useState('');
  const [dmReplies, setDmReplies] = useState('');
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>('Medium');
  const [activityNote, setActivityNote] = useState('');
  const [mainTopics, setMainTopics] = useState('');
  const [commonQuestions, setCommonQuestions] = useState('');
  const [contentResponse, setContentResponse] = useState('');
  const [notes, setNotes] = useState('');
  const [polls, setPolls] = useState<FormPoll[]>([structuredClone(EMPTY_POLL)]);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Load the selected week: the saved entry if there is one, otherwise last
  // week's numbers as a starting point.
  //
  // Deliberately does NOT clear `message`: saving calls router.refresh(), which
  // makes `existing` appear and re-runs this effect — clearing here would wipe
  // the "Saved" confirmation the user needs to see. The week picker clears it
  // instead, which is the only time a stale message would mislead.
  useEffect(() => {
    if (existing) {
      setTotalMembers(String(existing.totalMembers));
      setNewMembersOverride(
        existing.newMembersOverride === null || existing.newMembersOverride === undefined
          ? ''
          : String(existing.newMembersOverride),
      );
      setDmsSent(String(existing.dmsSent));
      setDmReplies(String(existing.dmReplies));
      setActivityLevel(existing.activityLevel);
      setActivityNote(existing.activityNote);
      // Topics are entered comma-separated; questions one per line.
      setMainTopics(existing.mainTopics.join(', '));
      setCommonQuestions(existing.commonQuestions.join('\n'));
      setContentResponse(existing.contentResponse);
      setNotes(existing.notes);
      setPolls(toFormPolls(existing.polls));
      return;
    }
    setTotalMembers(previous ? String(previous.totalMembers) : '');
    setNewMembersOverride('');
    setDmsSent('');
    setDmReplies('');
    setActivityLevel(previous?.activityLevel ?? 'Medium');
    // The qualitative fields describe THIS week, so they never carry over from
    // last week — a stale topic list would read as a fresh observation.
    setActivityNote('');
    setMainTopics('');
    setCommonQuestions('');
    setContentResponse('');
    setNotes('');
    setPolls([structuredClone(EMPTY_POLL)]);
  }, [existing, previous, weekStart]);

  /* ---------------------------------------------------------- live derived */

  const totalMembersNum = num(totalMembers);
  const overrideNum = num(newMembersOverride);
  const derivedNewMembers =
    overrideNum !== null
      ? overrideNum
      : totalMembersNum !== null && previous
        ? totalMembersNum - previous.totalMembers
        : null;

  const growthPct =
    derivedNewMembers !== null && previous && previous.totalMembers > 0
      ? (derivedNewMembers / previous.totalMembers) * 100
      : null;

  const pollResponseTotal = polls.reduce(
    (sum, poll) =>
      sum + poll.options.reduce((s, o) => s + (num(o.count) ?? 0), 0),
    0,
  );

  const pollRate =
    totalMembersNum && totalMembersNum > 0 ? (pollResponseTotal / totalMembersNum) * 100 : null;

  // Live previews for the qualitative fields, so the reader sees how their text
  // will be split before they save it.
  const topicPreview = splitList(mainTopics);
  const questionCount = splitList(commonQuestions).length;

  const dmsSentNum = num(dmsSent);
  const dmRepliesNum = num(dmReplies);
  const dmRate =
    dmsSentNum && dmsSentNum > 0 && dmRepliesNum !== null
      ? (dmRepliesNum / dmsSentNum) * 100
      : null;

  /* -------------------------------------------------------------- handlers */

  function updatePoll(index: number, patch: Partial<FormPoll>) {
    setPolls((current) =>
      current.map((poll, i) => (i === index ? { ...poll, ...patch } : poll)),
    );
  }

  function updateOption(pollIndex: number, optionIndex: number, patch: Partial<{ label: string; count: string }>) {
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

    if (totalMembersNum === null || totalMembersNum < 0) {
      setMessage({ kind: 'err', text: 'Enter the total member count for this week.' });
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
          totalMembers: totalMembersNum,
          newMembersOverride: overrideNum,
          polls: payloadPolls,
          dmsSent: dmsSentNum ?? 0,
          dmReplies: dmRepliesNum ?? 0,
          activityLevel,
          activityNote: activityNote.trim(),
          // Sent as arrays; the API also accepts the raw strings and splits them.
          mainTopics: splitList(mainTopics),
          commonQuestions: splitList(commonQuestions),
          contentResponse: contentResponse.trim(),
          notes: notes.trim(),
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Save failed (${res.status})`);
      }

      setMessage({
        kind: 'ok',
        text: `Saved ${groupLabel} · W${isoWeekNumber(weekStart)}.`,
      });
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
      {existing ? (
        <div className="prefillNote">
          Editing the saved entry for <strong>{formatWeekRange(weekStart)}</strong>. Saving
          overwrites it.
        </div>
      ) : previous ? (
        <div className="prefillNote">
          Member count pre-filled from <strong>{formatWeekRange(previous.weekStart)}</strong> (
          {previous.totalMembers.toLocaleString('en-US')} members) — just edit it to this week’s
          number and the delta is worked out for you.
        </div>
      ) : (
        <div className="prefillNote">
          First entry for {groupLabel}. Growth figures start from next week’s entry.
        </div>
      )}

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
                {entries.some((e) => e.weekStart === week) ? ' · saved' : ''}
              </option>
            ))}
          </select>
          <span className="field__computed">&nbsp;</span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="entry-members">
            Total members
            <span className="field__hint">required</span>
          </label>
          <input
            id="entry-members"
            type="number"
            min="0"
            inputMode="numeric"
            value={totalMembers}
            onChange={(e) => setTotalMembers(e.target.value)}
            placeholder={previous ? String(previous.totalMembers) : '0'}
            required
          />
          <span className="field__computed">
            {growthPct !== null ? `${formatSignedPercent(growthPct)} vs last week` : ' '}
          </span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="entry-new">
            New members
            <span className="field__hint">auto</span>
          </label>
          <input
            id="entry-new"
            type="number"
            inputMode="numeric"
            value={newMembersOverride}
            onChange={(e) => setNewMembersOverride(e.target.value)}
            placeholder={
              derivedNewMembers !== null && overrideNum === null
                ? String(derivedNewMembers)
                : 'auto from delta'
            }
          />
          <span className="field__computed">
            {derivedNewMembers !== null
              ? `${formatSigned(derivedNewMembers)} ${overrideNum !== null ? 'entered' : 'from delta'}`
              : ' '}
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
            placeholder={previous ? `last week: ${previous.dmsSent}` : '0'}
          />
          <span className="field__computed">&nbsp;</span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="entry-replies">
            DM replies
          </label>
          <input
            id="entry-replies"
            type="number"
            min="0"
            inputMode="numeric"
            value={dmReplies}
            onChange={(e) => setDmReplies(e.target.value)}
            placeholder={previous ? `last week: ${previous.dmReplies}` : '0'}
          />
          <span className="field__computed">
            {dmRate !== null ? `${formatPercent(dmRate)} reply rate` : ' '}
          </span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="entry-activity">
            Activity level
          </label>
          <select
            id="entry-activity"
            value={activityLevel}
            onChange={(e) => setActivityLevel(e.target.value as ActivityLevel)}
          >
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
          </select>
          <span className="field__computed">
            {previous && !existing ? `last week: ${previous.activityLevel}` : ' '}
          </span>
        </div>
        {/* Directly after the dropdown, so the level and its reason are entered
            together rather than in two different parts of the form. */}
        <div className="field field--activityNote">
          <label className="field__label" htmlFor="entry-activity-note">
            Activity note
            <span className="field__hint">why this level?</span>
          </label>
          <input
            id="entry-activity-note"
            type="text"
            value={activityNote}
            onChange={(e) => setActivityNote(e.target.value)}
            placeholder="e.g. spike around the Tuesday poll, quiet after that"
            maxLength={500}
          />
          <span className="field__computed">&nbsp;</span>
        </div>
      </div>

      <fieldset className="fieldset">
        <legend className="fieldset__legend">What the week was about</legend>

        <div className="field" style={{ marginBottom: 12 }}>
          <label className="field__label" htmlFor="entry-topics">
            Main topics
            <span className="field__hint">comma-separated</span>
          </label>
          <input
            id="entry-topics"
            type="text"
            value={mainTopics}
            onChange={(e) => setMainTopics(e.target.value)}
            placeholder="Scholarships, Visa process, IELTS"
          />
          {/* Live chip preview, so the split is visible before saving. */}
          {topicPreview.length > 0 ? (
            <div className="tagRow" style={{ marginTop: 6 }}>
              {topicPreview.map((topic) => (
                <span className="tag" key={topic}>
                  {topic}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="field" style={{ marginBottom: 12 }}>
          <label className="field__label" htmlFor="entry-questions">
            Common student questions
            <span className="field__hint">
              one per line
              {questionCount > 0
                ? ` · ${questionCount} question${questionCount === 1 ? '' : 's'}`
                : ''}
            </span>
          </label>
          <textarea
            id="entry-questions"
            className="textarea--list"
            value={commonQuestions}
            onChange={(e) => setCommonQuestions(e.target.value)}
            placeholder={'Do I need a UK guarantor to book?\nCan I pay rent in instalments?'}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="entry-content-response">
            Content response
            <span className="field__hint">how students reacted to what you posted</span>
          </label>
          <textarea
            id="entry-content-response"
            value={contentResponse}
            onChange={(e) => setContentResponse(e.target.value)}
            placeholder="Poll got the most replies; the property carousel was mostly skimmed."
            maxLength={1000}
          />
        </div>
      </fieldset>

      <div>
        <div className="rowBetween" style={{ marginBottom: 9 }}>
          <span className="field__label">
            Polls this week
            <span className="field__hint">
              {pollResponseTotal > 0
                ? `${pollResponseTotal} responses${pollRate !== null ? ` · ${formatPercent(pollRate)} response rate` : ''}`
                : 'leave the question blank if you didn’t post one'}
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

        {polls.map((poll, pollIndex) => {
          const responses = poll.options.reduce((s, o) => s + (num(o.count) ?? 0), 0);
          return (
            <fieldset className="fieldset" key={pollIndex} style={{ marginBottom: 10 }}>
              <legend className="fieldset__legend">
                Poll {pollIndex + 1}
                {responses > 0 ? ` · ${responses} responses` : ''}
              </legend>

              <div className="field" style={{ marginBottom: 11 }}>
                <input
                  type="text"
                  value={poll.question}
                  onChange={(e) => updatePoll(pollIndex, { question: e.target.value })}
                  placeholder="Poll question"
                  aria-label={`Poll ${pollIndex + 1} question`}
                />
              </div>

              {poll.options.map((option, optionIndex) => (
                <div className="optionRow" key={optionIndex}>
                  <div className="field optionRow__label">
                    <input
                      type="text"
                      value={option.label}
                      onChange={(e) =>
                        updateOption(pollIndex, optionIndex, { label: e.target.value })
                      }
                      placeholder={`Option ${optionIndex + 1}`}
                      aria-label={`Poll ${pollIndex + 1} option ${optionIndex + 1} label`}
                    />
                  </div>
                  <div className="field optionRow__count">
                    <input
                      type="number"
                      min="0"
                      inputMode="numeric"
                      value={option.count}
                      onChange={(e) =>
                        updateOption(pollIndex, optionIndex, { count: e.target.value })
                      }
                      placeholder="votes"
                      aria-label={`Poll ${pollIndex + 1} option ${optionIndex + 1} count`}
                    />
                  </div>
                  <div className="optionRow__remove">
                    <button
                      type="button"
                      className="iconBtn"
                      aria-label="Remove option"
                      onClick={() =>
                        updatePoll(pollIndex, {
                          options: poll.options.filter((_, j) => j !== optionIndex),
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}

              <div className="row">
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() =>
                    updatePoll(pollIndex, {
                      options: [...poll.options, { label: '', count: '' }],
                    })
                  }
                >
                  + Add option
                </button>
                {polls.length > 1 ? (
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => setPolls((c) => c.filter((_, i) => i !== pollIndex))}
                  >
                    Remove poll
                  </button>
                ) : null}
              </div>
            </fieldset>
          );
        })}
      </div>

      <div className="field field--wide">
        <label className="field__label" htmlFor="entry-notes">
          Notes / observations
        </label>
        <textarea
          id="entry-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What drove engagement this week? Anything worth repeating or fixing?"
        />
      </div>

      <div className="formFoot">
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? 'Saving…' : existing ? 'Update week' : 'Save week'}
        </button>
        {message ? (
          <span
            className={`formMsg formMsg--${message.kind === 'ok' ? 'ok' : 'err'}`}
            role="status"
          >
            {message.text}
          </span>
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>
            Poll response rate, DM reply rate and growth % are calculated — never typed.
          </span>
        )}
      </div>
    </form>
  );
}
