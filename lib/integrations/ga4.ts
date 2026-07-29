import { google } from 'googleapis';
import type { Ga4SessionRow, IntegrationState } from '../types';
import { googleAuth, hasGoogleCreds } from './google-auth';
import { demoGa4 } from '../demo';
import { groupsWithSource } from '../groups';
import { lastNWeeks, weekEnd } from '../weeks';

/**
 * GA4 traffic via the Data API (analyticsdata v1beta).
 *
 * One report request, dimensioned by date × campaign × source × medium, filtered
 * to the campaigns declared in lib/groups.ts. The window is the trailing 8 weeks
 * so the trend charts always have their full range.
 */

const TREND_WEEKS = 8;

export interface Ga4Result {
  rows: Ga4SessionRow[];
  state: IntegrationState;
}

export async function fetchGa4Sessions(endWeek: string): Promise<Ga4Result> {
  const propertyId = process.env.GA4_PROPERTY_ID;
  const fetchedAt = new Date().toISOString();

  if (!propertyId || !hasGoogleCreds()) {
    return {
      rows: demoGa4(endWeek),
      state: {
        name: 'ga4',
        label: 'Site traffic (GA4)',
        status: 'demo',
        message: !propertyId
          ? 'Set GA4_PROPERTY_ID to pull real traffic.'
          : 'Add Google service-account credentials to pull real traffic.',
        fetchedAt,
      },
    };
  }

  const weeks = lastNWeeks(TREND_WEEKS, endWeek);
  const startDate = weeks[0];
  const endDate = weekEnd(weeks[weeks.length - 1]);

  // Only campaigns of communities that declare GA4 coverage (today: Community
  // #2). Querying Community #1's campaigns would attribute traffic to groups
  // this property doesn't represent.
  const campaigns = groupsWithSource('ga4').flatMap((g) => g.utmCampaigns);

  if (campaigns.length === 0) {
    return {
      rows: [],
      state: {
        name: 'ga4',
        label: 'Site traffic (GA4)',
        status: 'live',
        message: 'No community declares GA4 coverage in lib/groups.ts — nothing to pull.',
        fetchedAt,
      },
    };
  }

  try {
    const auth = googleAuth();
    const analyticsData = google.analyticsdata({ version: 'v1beta', auth });

    const res = await analyticsData.properties.runReport({
      property: `properties/${propertyId.replace(/^properties\//, '')}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [
          { name: 'date' },
          { name: 'sessionCampaignName' },
          { name: 'sessionSource' },
          { name: 'sessionMedium' },
        ],
        metrics: [{ name: 'sessions' }],
        dimensionFilter: {
          filter: {
            fieldName: 'sessionCampaignName',
            inListFilter: { values: campaigns, caseSensitive: false },
          },
        },
        limit: '100000',
      },
    });

    const rows: Ga4SessionRow[] = (res.data.rows ?? []).map((row) => {
      const dims = row.dimensionValues ?? [];
      const raw = String(dims[0]?.value ?? '');
      // GA4 returns dates as YYYYMMDD.
      const date =
        raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
      return {
        date,
        campaign: String(dims[1]?.value ?? ''),
        source: String(dims[2]?.value ?? ''),
        medium: String(dims[3]?.value ?? ''),
        sessions: Number(row.metricValues?.[0]?.value ?? 0),
      };
    });

    const total = rows.reduce((sum, r) => sum + r.sessions, 0);
    return {
      rows,
      state: {
        name: 'ga4',
        label: 'Site traffic (GA4)',
        status: 'live',
        message:
          rows.length === 0
            ? `No sessions on the tracked campaigns between ${startDate} and ${endDate}. Check the campaign names in lib/groups.ts.`
            : `${total.toLocaleString('en-US')} sessions across ${rows.length.toLocaleString('en-US')} rows.`,
        fetchedAt,
      },
    };
  } catch (err) {
    return {
      rows: [],
      state: {
        name: 'ga4',
        label: 'Site traffic (GA4)',
        status: 'error',
        message: err instanceof Error ? err.message : 'Unknown GA4 error.',
        fetchedAt,
      },
    };
  }
}
