import type { PollHistoryRow } from '@/lib/types';
import { formatExact, formatPercent } from '@/lib/metrics';
import { formatWeekRange } from '@/lib/weeks';

/** Poll history for one group: question, week, responses, top answer. */
export function PollHistoryTable({ rows }: { rows: PollHistoryRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="emptyState">
        No polls logged yet. Add one with this week’s entry below.
      </div>
    );
  }

  return (
    <div className="tableWrap">
      <table className="data">
        <thead>
          <tr>
            <th>Question</th>
            <th>Week</th>
            <th className="num">Responses</th>
            <th className="num">Rate</th>
            <th>Top answer</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.weekStart}-${index}`}>
              <td style={{ whiteSpace: 'normal', minWidth: 240 }}>{row.question}</td>
              <td>{formatWeekRange(row.weekStart)}</td>
              <td className="num">{formatExact(row.responses)}</td>
              <td className="num">{formatPercent(row.responseRatePct)}</td>
              <td>
                {row.topAnswer}{' '}
                <span className="muted">({formatExact(row.topAnswerCount)})</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
