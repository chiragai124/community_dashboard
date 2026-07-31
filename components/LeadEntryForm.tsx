'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { GroupConfig, GroupSlug } from '@/lib/types';
import { formatWeekLabel } from '@/lib/weeks';

/**
 * Adding leads: one at a time, or a pasted block from a spreadsheet.
 *
 * Both modes exist because both are real. A lead arriving in a DM gets typed in;
 * a batch collected in a sheet gets pasted, because typing thirty rows one field
 * at a time is how a weekly routine stops happening.
 *
 * Every lead is filed against a group and a week, so the funnel can answer "this
 * week" and "which channel produced it" without a second question.
 */

const EMPTY = { name: '', email: '', phone: '', university: '', country: '' };

export function LeadEntryForm({
  groups,
  weekOptions,
  defaultWeek,
  defaultGroup,
}: {
  groups: GroupConfig[];
  weekOptions: string[];
  defaultWeek: string;
  defaultGroup: GroupSlug;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<'single' | 'paste'>('single');
  const [group, setGroup] = useState<GroupSlug>(defaultGroup);
  const [weekStart, setWeekStart] = useState(defaultWeek);
  const [fields, setFields] = useState(EMPTY);
  const [block, setBlock] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const working = saving || isPending;

  async function save(payload: Record<string, unknown>) {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group, weekStart, ...payload }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        added?: number;
        updated?: number;
        skipped?: number;
        note?: string | null;
      };
      if (!res.ok) throw new Error(body.error ?? `Save failed (${res.status})`);

      const parts: string[] = [];
      if (body.added) parts.push(`${body.added} added`);
      if (body.updated) parts.push(`${body.updated} updated`);
      if (body.skipped) parts.push(`${body.skipped} skipped as empty`);
      setMessage({
        kind: 'ok',
        text: `${parts.join(' · ') || 'Saved'}.${body.note ? ` ${body.note}` : ''}`,
      });
      setFields(EMPTY);
      setBlock('');
      startTransition(() => router.refresh());
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Save failed.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault();
        void save(mode === 'paste' ? { block } : fields);
      }}
    >
      <div className="segmented" role="tablist" aria-label="Lead entry mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'single'}
          className={`segmented__btn${mode === 'single' ? ' segmented__btn--active' : ''}`}
          onClick={() => setMode('single')}
        >
          One lead
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'paste'}
          className={`segmented__btn${mode === 'paste' ? ' segmented__btn--active' : ''}`}
          onClick={() => setMode('paste')}
        >
          Paste a block
        </button>
      </div>

      <div className="formGrid">
        <div className="field">
          <label className="field__label" htmlFor="lead-group">
            Group
          </label>
          <select
            id="lead-group"
            value={group}
            onChange={(e) => setGroup(e.target.value as GroupSlug)}
            disabled={working}
          >
            {groups.map((g) => (
              <option key={g.slug} value={g.slug}>
                {g.flag} {g.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="lead-week">
            Week
          </label>
          <select
            id="lead-week"
            value={weekStart}
            onChange={(e) => setWeekStart(e.target.value)}
            disabled={working}
          >
            {weekOptions.map((week) => (
              <option key={week} value={week}>
                {formatWeekLabel(week)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {mode === 'single' ? (
        <div className="formGrid">
          {(
            [
              ['name', 'Name', 'text'],
              ['email', 'Email', 'email'],
              ['phone', 'Phone no.', 'tel'],
              ['university', 'University', 'text'],
              ['country', 'Country', 'text'],
            ] as const
          ).map(([key, label, type]) => (
            <div className="field" key={key}>
              <label className="field__label" htmlFor={`lead-${key}`}>
                {label}
              </label>
              <input
                id={`lead-${key}`}
                type={type}
                value={fields[key]}
                onChange={(e) => setFields((current) => ({ ...current, [key]: e.target.value }))}
                disabled={working}
                autoComplete="off"
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="field field--wide">
          <label className="field__label" htmlFor="lead-block">
            Paste rows
            <span className="field__hint">
              one lead per line — Name, Email, Phone, University, Country
            </span>
          </label>
          <textarea
            id="lead-block"
            className="pasteBox"
            value={block}
            onChange={(e) => setBlock(e.target.value)}
            disabled={working}
            placeholder={
              'Priya Sharma\tpriya@example.com\t+44 7700 900123\tUniversity of Leeds\tUK\n' +
              'Wei Chen\twei.chen@example.com\t+1 555 0142\tPurdue University\tUSA'
            }
          />
          <span className="field__hint">
            Copy straight from a spreadsheet — tab-separated is detected, and commas work
            too. If the first row is column names it is used to map the columns, so a
            different order still lands correctly. Re-pasting rows you already saved
            updates them rather than duplicating.
          </span>
        </div>
      )}

      <div className="formFoot">
        <button type="submit" className="btn btn--primary" disabled={working}>
          {working ? 'Saving…' : mode === 'paste' ? 'Save pasted leads' : 'Save lead'}
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
