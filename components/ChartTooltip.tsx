'use client';

import type { ReactNode } from 'react';
import { CHART } from './chart-theme';

/**
 * The one tooltip used by every chart. Series identity comes from the coloured
 * line-key beside the name; the text itself stays in tooltip ink.
 */

export interface TooltipRow {
  name: string;
  value: string;
  color: string;
  emphasis?: boolean;
}

export function TooltipShell({
  head,
  rows,
  footer,
}: {
  head: string;
  rows: TooltipRow[];
  footer?: ReactNode;
}) {
  return (
    <div className="tt">
      <div className="tt__head">{head}</div>
      {rows.map((row) => (
        <div className="tt__row" key={row.name}>
          <span className="tt__key" style={{ background: row.color }} />
          <span className="tt__name" style={row.emphasis ? { color: '#fff' } : undefined}>
            {row.name}
          </span>
          <span className="tt__val">{row.value}</span>
        </div>
      ))}
      {footer ? <div className="tt__head" style={{ marginTop: 6, marginBottom: 0 }}>{footer}</div> : null}
    </div>
  );
}

/** Recharts hands the payload in as `any`-shaped props; narrow it here. */
export interface RechartsTooltipPayloadItem {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string | null;
  color?: string;
  payload?: Record<string, unknown>;
}

export interface RechartsTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: RechartsTooltipPayloadItem[];
}

export function defaultKeyColor(index: number): string {
  return index === 0 ? CHART.ACCENT : CHART.CONTEXT;
}
