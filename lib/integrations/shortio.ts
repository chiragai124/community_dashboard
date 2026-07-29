import type { IntegrationState, ShortLinkClicks } from '../types';
import { bucketSource } from '../groups';
import { demoShortLinks } from '../demo';

/**
 * Short.io tracked-link clicks.
 *
 * Uses the public REST API with an API key (Short.io dashboard → Integrations
 * & API → API keys). Links are matched to groups by their Short.io tag, set in
 * lib/groups.ts as `shortioTag` (currently `scholarship_teamB` for Community
 * #2). The tag identifies which community a link belongs to and applies to
 * Short.io only — Sheets and GA4 rows are matched by campaign/country instead.
 *
 * Note on the numbers: /links returns each link's lifetime click total, not
 * clicks within a date window. The dashboard therefore treats the conversion
 * rate per source as "leads this week ÷ lifetime clicks" and labels it as a
 * floor rather than an exact weekly rate.
 */

const API_BASE = 'https://api.short.io/api';
const PAGE_SIZE = 150;

interface ShortIoLink {
  idString?: string;
  id?: string | number;
  path?: string;
  title?: string;
  tags?: string[];
  totalClicks?: number;
  clicks?: number;
}

export interface ShortIoResult {
  links: ShortLinkClicks[];
  state: IntegrationState;
}

export async function fetchShortLinks(): Promise<ShortIoResult> {
  const apiKey = process.env.SHORTIO_API_KEY;
  const domainId = process.env.SHORTIO_DOMAIN_ID;
  const fetchedAt = new Date().toISOString();

  if (!apiKey || !domainId) {
    return {
      links: demoShortLinks(),
      state: {
        name: 'shortio',
        label: 'Link clicks (Short.io)',
        status: 'demo',
        message: 'Set SHORTIO_API_KEY and SHORTIO_DOMAIN_ID to pull real click counts.',
        fetchedAt,
      },
    };
  }

  try {
    const links: ShortLinkClicks[] = [];
    let pageToken: string | undefined;
    let pages = 0;

    // Paginate until Short.io stops handing back a token (cap at 20 pages).
    do {
      const url = new URL(`${API_BASE}/links`);
      url.searchParams.set('domain_id', domainId);
      url.searchParams.set('limit', String(PAGE_SIZE));
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const res = await fetch(url.toString(), {
        headers: { accept: 'application/json', authorization: apiKey },
        cache: 'no-store',
      });

      if (!res.ok) {
        throw new Error(`Short.io responded ${res.status}: ${await res.text()}`);
      }

      const body = (await res.json()) as { links?: ShortIoLink[]; nextPageToken?: string };
      for (const link of body.links ?? []) {
        const tags = link.tags ?? [];
        const title = link.title ?? link.path ?? '';
        // One row per tag, so a link tagged for two groups counts in both.
        for (const tag of tags) {
          links.push({
            id: String(link.idString ?? link.id ?? link.path ?? title),
            title,
            tag,
            clicks: Number(link.totalClicks ?? link.clicks ?? 0),
            // Bucket by TITLE ONLY. The tag identifies the community, not the
            // marketing source — feeding `scholarship_teamB` into the bucketer
            // would classify every one of that community's links as
            // "Scholarship teams" regardless of what it actually promotes.
            source: bucketSource(title),
          });
        }
      }

      pageToken = body.nextPageToken;
      pages += 1;
    } while (pageToken && pages < 20);

    const totalClicks = links.reduce((sum, l) => sum + l.clicks, 0);
    return {
      links,
      state: {
        name: 'shortio',
        label: 'Link clicks (Short.io)',
        status: 'live',
        message:
          links.length === 0
            ? 'No tagged links found. Tag your links with the values in lib/groups.ts.'
            : `${links.length} tagged links, ${totalClicks.toLocaleString('en-US')} clicks.`,
        fetchedAt,
      },
    };
  } catch (err) {
    return {
      links: [],
      state: {
        name: 'shortio',
        label: 'Link clicks (Short.io)',
        status: 'error',
        message: err instanceof Error ? err.message : 'Unknown Short.io error.',
        fetchedAt,
      },
    };
  }
}
