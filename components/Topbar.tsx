'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { COMMUNITIES } from '@/lib/groups';
import type { ScopeSlug } from '@/lib/types';

/**
 * Top nav: five flat tabs — Overview, one per community, and Landing page &
 * WADL — matching the reference report's pill-tab layout. Replaces the old
 * two-level sidebar (scope switcher + per-group links): group detail pages
 * are reached from a group's snapshot card on its Community tab now, not
 * from primary nav.
 */
export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [resetting, setResetting] = useState(false);

  const scope: ScopeSlug = (() => {
    if (pathname === '/') return 'overview';
    if (pathname.startsWith('/merged')) return 'merged';
    const match = pathname.match(/^\/c\/([^/]+)/);
    if (match) {
      const found = COMMUNITIES.find((c) => c.slug === match[1]);
      if (found) return found.slug;
    }
    return 'overview';
  })();

  async function resetImports() {
    if (!window.confirm('Reset every uploaded import (WhatsApp, Short.io, GA4)? This can’t be undone.')) return;
    setResetting(true);
    try {
      const res = await fetch('/api/imports/reset', { method: 'POST' });
      if (!res.ok) throw new Error(`Reset failed (${res.status})`);
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Reset failed.');
    } finally {
      setResetting(false);
    }
  }

  return (
    <nav className="topbar" aria-label="Dashboard sections">
      <div className="topbar__brand">
        <span className="topbar__dot" aria-hidden="true" />
        <div className="topbar__brandText">
          <span className="topbar__brandName">amber Communities</span>
          <span className="topbar__brandSub">Weekly engagement report</span>
        </div>
      </div>

      <div className="topbar__nav">
        <Link href="/" className={`topbar__tab${scope === 'overview' ? ' topbar__tab--active' : ''}`}>
          Overview
        </Link>
        {COMMUNITIES.map((c) => (
          <Link
            key={c.slug}
            href={`/c/${c.slug}`}
            className={`topbar__tab${scope === c.slug ? ' topbar__tab--active' : ''}`}
          >
            {c.label}
          </Link>
        ))}
        <Link href="/merged" className={`topbar__tab${scope === 'merged' ? ' topbar__tab--active' : ''}`}>
          Landing page &amp; WADL
        </Link>
      </div>

      <div className="topbar__spacer">
        <button
          type="button"
          className="btn btn--sm"
          style={{ background: 'transparent', borderColor: 'var(--black-line)', color: '#b8b2ac' }}
          onClick={() => void resetImports()}
          disabled={resetting}
        >
          {resetting ? 'Resetting…' : 'Reset all imports'}
        </button>
      </div>
    </nav>
  );
}
