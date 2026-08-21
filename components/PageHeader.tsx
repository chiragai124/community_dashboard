import type { ReactNode } from 'react';
import { WeekPicker } from '@/components/WeekPicker';

/**
 * Top of every page: the current group (or view) name plus the period being
 * shown.
 *
 * Two mutually exclusive modes:
 *   - `weekStart` — an editable week picker (see `WeekPicker`). Used only by
 *     the Landing page & WADL page, which is still on GA4/Short.io's
 *     original Monday-anchored week system.
 *   - `periodLabel` — plain static text (e.g. "12 - 19 Aug 2026"). Used by
 *     every WhatsApp-driven page, where the date range is set manually per
 *     upload rather than picked from a shared week control.
 *
 * There is no data-source strip or refresh control any more: nothing is fetched,
 * so there is no connection state to report and nothing to re-pull. What was
 * imported, and when, is shown by the import panel on the pages that have one.
 */
export function PageHeader({
  eyebrow,
  title,
  titleAccessory,
  weekStart,
  weekCaption = 'This week',
  periodLabel,
  periodCaption = 'Report period',
  children,
}: {
  eyebrow: string;
  title: string;
  titleAccessory?: ReactNode;
  weekStart?: string;
  weekCaption?: string;
  /** Static date-range text — pass instead of `weekStart` for WhatsApp-driven pages. */
  periodLabel?: string | null;
  periodCaption?: string;
  children?: ReactNode;
}) {
  return (
    <header className="pageHead">
      <div className="pageHead__titleWrap">
        <div className="pageHead__eyebrow">{eyebrow}</div>
        <h1 className="pageHead__title">
          {title}
          {titleAccessory}
        </h1>
      </div>

      <div className="pageHead__meta">
        {children}
        {weekStart ? (
          <WeekPicker weekStart={weekStart} label={weekCaption} />
        ) : (
          <span className="weekChip">
            <span className="weekChip__label">{periodCaption}</span>
            <span className="weekChip__value">{periodLabel ?? 'No report filed yet'}</span>
          </span>
        )}
      </div>
    </header>
  );
}
