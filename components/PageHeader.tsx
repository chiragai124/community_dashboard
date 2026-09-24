import type { ReactNode } from 'react';

/**
 * Top of every page: the current group (or view) name plus the period being
 * shown.
 *
 * The period here is display only. Choosing which period to look at, and
 * changing which one new data is filed under, both live in the report period
 * picker below it — one control for both, rather than a week chip up here
 * that does one of them and a picker further down that does the other.
 *
 * There is no data-source strip or refresh control: nothing is fetched, so
 * there is no connection state to report and nothing to re-pull. What was
 * imported, and when, is shown by the import panel on the pages that have one.
 */
export function PageHeader({
  eyebrow,
  title,
  titleAccessory,
  periodLabel,
  periodCaption = 'Report period',
  children,
}: {
  eyebrow: string;
  title: string;
  titleAccessory?: ReactNode;
  /** Static date-range text, e.g. "12 - 19 Aug 2026". */
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
        <span className="weekChip">
          <span className="weekChip__label">{periodCaption}</span>
          <span className="weekChip__value">{periodLabel ?? 'No report filed yet'}</span>
        </span>
      </div>
    </header>
  );
}
