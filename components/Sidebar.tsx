'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { GROUPS } from '@/lib/groups';
import { formatCount } from '@/lib/metrics';
import type { GroupSlug } from '@/lib/types';

/**
 * Left sidebar: Overview → the five groups → Comparison → Trends.
 * Black background, accent active state, per the brand.
 */
export function Sidebar({
  memberCounts,
  backendLabel,
}: {
  /** Latest member count per group, shown next to each name. */
  memberCounts: Partial<Record<GroupSlug, number | null>>;
  backendLabel: string;
}) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="sidebar" aria-label="Dashboard sections">
      <div className="sidebar__brand">
        <div className="sidebar__brandRow">
          <span className="sidebar__dot" aria-hidden="true" />
          <span className="sidebar__brandName">amber Communities</span>
        </div>
        <div className="sidebar__brandSub">WhatsApp engagement &amp; leads</div>
      </div>

      <div className="sidebar__nav">
        <Link href="/" className={`navItem${isActive('/') ? ' navItem--active' : ''}`}>
          <span className="navItem__flag" aria-hidden="true">
            ▦
          </span>
          Overview
        </Link>

        <div className="sidebar__section">Groups</div>
        {GROUPS.map((group) => {
          const href = `/group/${group.slug}`;
          const members = memberCounts[group.slug];
          return (
            <Link
              key={group.slug}
              href={href}
              className={`navItem${isActive(href) ? ' navItem--active' : ''}`}
            >
              <span className="navItem__flag" aria-hidden="true">
                {group.flag}
              </span>
              {group.label}
              <span className="navItem__count">
                {members === null || members === undefined ? '—' : formatCount(members)}
              </span>
            </Link>
          );
        })}

        <div className="sidebar__section">Analysis</div>
        <Link
          href="/comparison"
          className={`navItem${isActive('/comparison') ? ' navItem--active' : ''}`}
        >
          <span className="navItem__flag" aria-hidden="true">
            ⇄
          </span>
          Comparison
        </Link>
        <Link
          href="/trends"
          className={`navItem${isActive('/trends') ? ' navItem--active' : ''}`}
        >
          <span className="navItem__flag" aria-hidden="true">
            ◠
          </span>
          Trends
        </Link>
      </div>

      <div className="sidebar__foot">
        Manual entries: {backendLabel}
        <br />
        No WhatsApp API in use.
      </div>
    </nav>
  );
}
