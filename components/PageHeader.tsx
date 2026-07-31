import type { ReactNode } from 'react';
import { formatWeekRange, isoWeekNumber } from '@/lib/weeks';

/**
 * Top of every page: the current group (or view) name plus the week being shown.
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
  children,
}: {
  eyebrow: string;
  title: string;
  titleAccessory?: ReactNode;
  weekStart: string;
  weekCaption?: string;
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
        <span className="weekChip">
          <span className="weekChip__label">{weekCaption}</span>
          <span className="weekChip__value">{formatWeekRange(weekStart)}</span>
          <span className="weekChip__label">W{isoWeekNumber(weekStart)}</span>
        </span>
      </div>
    </header>
  );
}
