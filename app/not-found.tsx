import Link from 'next/link';
import { GROUPS } from '@/lib/groups';

export default function NotFound() {
  return (
    <div className="content">
      <h1 className="pageHead__title" style={{ marginBottom: 8 }}>
        Page not found
      </h1>
      <p className="muted" style={{ marginTop: 0 }}>
        That view doesn’t exist. Five communities are tracked here:
      </p>
      <div className="row">
        {GROUPS.map((group) => (
          <Link key={group.slug} href={`/group/${group.slug}`} className="btn btn--sm">
            {group.flag} {group.label}
          </Link>
        ))}
        <Link href="/" className="btn btn--sm btn--dark">
          Overview
        </Link>
      </div>
    </div>
  );
}
