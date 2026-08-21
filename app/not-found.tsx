import Link from 'next/link';
import { COMMUNITIES } from '@/lib/groups';

export default function NotFound() {
  return (
    <div className="content">
      <h1 className="pageHead__title" style={{ marginBottom: 8 }}>
        Page not found
      </h1>
      <p className="muted" style={{ marginTop: 0 }}>
        That view doesn’t exist. These reports are available:
      </p>

      {COMMUNITIES.map((community) => (
        <div key={community.slug} style={{ marginBottom: 16 }}>
          <div className="sectionTitle" style={{ marginTop: 0 }}>
            {community.label} — {community.name}
          </div>
          <div className="row">
            <Link href={`/c/${community.slug}`} className="btn btn--sm btn--dark">
              Overview
            </Link>
            {community.groups.map((group) => (
              <Link
                key={group.slug}
                href={`/c/${community.slug}/group/${group.slug}`}
                className="btn btn--sm"
              >
                {group.flag} {group.label}
              </Link>
            ))}
          </div>
        </div>
      ))}

      <div className="sectionTitle" style={{ marginTop: 0 }}>
        Landing page &amp; WADL
      </div>
      <div className="row">
        <Link href="/merged" className="btn btn--sm btn--primary">
          Landing page &amp; WADL
        </Link>
      </div>
    </div>
  );
}
