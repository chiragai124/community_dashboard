import type { ReactNode } from 'react';
import type { IntegrationState } from '@/lib/types';
import { formatWeekRange, isoWeekNumber } from '@/lib/weeks';
import { formatRelativeTime } from '@/lib/metrics';
import { RefreshButton } from './RefreshButton';

/**
 * Top of every page: the current group (or view) name plus the week being
 * shown, then the data-source strip and the manual refresh control.
 */
export function PageHeader({
  eyebrow,
  title,
  titleAccessory,
  weekStart,
  weekCaption = 'This week',
  states,
  fetchedAt,
  children,
}: {
  eyebrow: string;
  title: string;
  titleAccessory?: ReactNode;
  weekStart: string;
  weekCaption?: string;
  states: IntegrationState[];
  fetchedAt: string;
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
        <SourceStrip states={states} fetchedAt={fetchedAt} />
      </div>
    </header>
  );
}

/** One pill per automated source, saying plainly whether it is live or demo. */
export function SourceStrip({
  states,
  fetchedAt,
}: {
  states: IntegrationState[];
  fetchedAt: string;
}) {
  return (
    <span className="sourceStrip">
      {states.map((state) => (
        <span
          className="sourcePill"
          key={state.name}
          title={`${state.label}: ${state.message}`}
        >
          <span
            className={`sourcePill__dot sourcePill__dot--${state.status === 'live' ? 'live' : 'demo'}`}
            aria-hidden="true"
          />
          {state.label.replace(/^.*\((.*)\)$/, '$1')}
          {state.status === 'live' ? '' : state.status === 'demo' ? ' · demo' : ' · error'}
        </span>
      ))}
      <span className="sourcePill" title={new Date(fetchedAt).toISOString()}>
        Pulled {formatRelativeTime(fetchedAt)}
      </span>
      <RefreshButton />
    </span>
  );
}
