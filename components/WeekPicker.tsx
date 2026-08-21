'use client';

import { useRouter, usePathname } from 'next/navigation';
import { isoWeekNumber } from '@/lib/weeks';

/**
 * The editable "This week" control in the page header. One date field —
 * pick any day and the page reloads showing that day's week (any date snaps
 * to its Monday, same as every other date this app accepts; picking a
 * Wednesday will show back as that week's Monday after navigating).
 *
 * Navigates via a `?week=` query param rather than local state, so the
 * chosen week is a real URL every page already knows how to read
 * (`loadDashboard(week)`), is shareable/bookmarkable, and survives a refresh.
 */
export function WeekPicker({
  weekStart,
  label = 'This week',
}: {
  weekStart: string;
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function onChange(value: string) {
    if (!value) return;
    router.push(`${pathname}?week=${value}`);
  }

  return (
    <span className="weekChip">
      <span className="weekChip__label">{label}</span>
      <input
        type="date"
        className="weekChip__input"
        value={weekStart}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Change the displayed week"
        title="Pick any day — the dashboard shows that day's Monday-to-Sunday week"
      />
      <span className="weekChip__label">W{isoWeekNumber(weekStart)}</span>
    </span>
  );
}
