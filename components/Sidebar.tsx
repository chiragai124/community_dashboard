'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { COMMUNITIES, countNoun, DEFAULT_COMMUNITY } from '@/lib/groups';
import { formatCount } from '@/lib/metrics';
import type { CommunitySlug, GroupSlug, ScopeSlug } from '@/lib/types';

/**
 * Left sidebar, two levels:
 *
 *   1. Scope switcher — Community #1 / Community #2 / Merged.
 *   2. Navigation for whichever scope is selected.
 *
 * The scope is read from the URL rather than held in state, so a link can point
 * straight at any view and the sidebar reflects it. Black background, accent
 * active state, per the brand.
 */
export function Sidebar({
  memberCounts,
  communityMembers,
  backendLabel,
}: {
  /** Latest member count per group, shown next to each group. */
  memberCounts: Partial<Record<GroupSlug, number | null>>;
  /** Pooled member count per community, shown on the switcher. */
  communityMembers: Partial<Record<CommunitySlug, number>>;
  backendLabel: string;
}) {
  const pathname = usePathname();

  /** Which of the three scopes the current URL is inside. */
  const scope: ScopeSlug = (() => {
    if (pathname.startsWith('/merged')) return 'merged';
    const match = pathname.match(/^\/c\/([^/]+)/);
    if (match) {
      const found = COMMUNITIES.find((c) => c.slug === match[1]);
      if (found) return found.slug;
    }
    return DEFAULT_COMMUNITY;
  })();

  const community = COMMUNITIES.find((c) => c.slug === scope);
  const mergedMembers = Object.values(communityMembers).reduce(
    (sum, n) => sum + (n ?? 0),
    0,
  );

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="sidebar" aria-label="Dashboard sections">
      <div className="sidebar__brand">
        <div className="sidebar__brandRow">
          <span className="sidebar__dot" aria-hidden="true" />
          <span className="sidebar__brandName">amber Communities</span>
        </div>
        <div className="sidebar__brandSub">WhatsApp engagement &amp; leads</div>
      </div>

      {/* Level 1 — the scope switcher */}
      <div className="scopeSwitch" role="group" aria-label="Select community">
        {COMMUNITIES.map((c) => (
          <Link
            key={c.slug}
            href={`/c/${c.slug}`}
            className={`scopeItem${scope === c.slug ? ' scopeItem--active' : ''}`}
            aria-current={scope === c.slug ? 'page' : undefined}
          >
            <span className="scopeItem__label">{c.label}</span>
            <span className="scopeItem__meta">
              {formatCount(communityMembers[c.slug] ?? 0)} members ·{' '}
              {countNoun(c.groups.length, c.groupNoun.toLowerCase())}
            </span>
          </Link>
        ))}
        <Link
          href="/merged"
          className={`scopeItem${scope === 'merged' ? ' scopeItem--active' : ''}`}
          aria-current={scope === 'merged' ? 'page' : undefined}
        >
          <span className="scopeItem__label">Merged</span>
          <span className="scopeItem__meta">
            {formatCount(mergedMembers)} members · both communities
          </span>
        </Link>
      </div>

      {/* Level 2 — navigation within the selected scope */}
      <div className="sidebar__nav">
        {scope === 'merged' ? (
          <>
            <Link
              href="/merged"
              className={`navItem${pathname === '/merged' ? ' navItem--active' : ''}`}
            >
              <span className="navItem__flag" aria-hidden="true">
                ▦
              </span>
              Combined overview
            </Link>
            <Link
              href="/merged/comparison"
              className={`navItem${isActive('/merged/comparison') ? ' navItem--active' : ''}`}
            >
              <span className="navItem__flag" aria-hidden="true">
                ⇄
              </span>
              All groups
            </Link>
            <Link
              href="/merged/trends"
              className={`navItem${isActive('/merged/trends') ? ' navItem--active' : ''}`}
            >
              <span className="navItem__flag" aria-hidden="true">
                ◠
              </span>
              Trends
            </Link>
          </>
        ) : community ? (
          <>
            <Link
              href={`/c/${community.slug}`}
              className={`navItem${pathname === `/c/${community.slug}` ? ' navItem--active' : ''}`}
            >
              <span className="navItem__flag" aria-hidden="true">
                ▦
              </span>
              Overview
            </Link>

            <div className="sidebar__section">{community.groupNoun}</div>
            {community.groups.map((group) => {
              const href = `/c/${community.slug}/group/${group.slug}`;
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
            {/* A one-group community has nothing to compare, so the page is
                hidden rather than shown with a single row. */}
            {community.groups.length > 1 ? (
              <Link
                href={`/c/${community.slug}/comparison`}
                className={`navItem${isActive(`/c/${community.slug}/comparison`) ? ' navItem--active' : ''}`}
              >
                <span className="navItem__flag" aria-hidden="true">
                  ⇄
                </span>
                Comparison
              </Link>
            ) : null}
            <Link
              href={`/c/${community.slug}/trends`}
              className={`navItem${isActive(`/c/${community.slug}/trends`) ? ' navItem--active' : ''}`}
            >
              <span className="navItem__flag" aria-hidden="true">
                ◠
              </span>
              Trends
            </Link>
          </>
        ) : null}
      </div>

      <div className="sidebar__foot">
        Manual entries: {backendLabel}
        <br />
        No WhatsApp API in use.
      </div>
    </nav>
  );
}
