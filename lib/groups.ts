import type { GroupConfig, GroupSlug } from './types';

/**
 * The five tracked communities. Sidebar order, card order and table row order
 * all come from this array — change it here and it changes everywhere.
 *
 * `sheetCountry`, `utmCampaigns` and `shortioTag` are the join keys against the
 * three automated sources. Adjust them to match your actual sheet values and
 * UTM naming; the dashboard reads nothing else to attribute a row to a group.
 */
export const GROUPS: GroupConfig[] = [
  {
    slug: 'uk',
    name: 'United Kingdom',
    label: 'UK',
    flag: '🇬🇧',
    sheetCountry: ['UK', 'United Kingdom', 'GB', 'England', 'Scotland', 'Wales'],
    utmCampaigns: ['community_uk', 'wa_community_uk'],
    shortioTag: 'community-uk',
  },
  {
    slug: 'usa',
    name: 'United States',
    label: 'USA',
    flag: '🇺🇸',
    sheetCountry: ['USA', 'US', 'United States', 'United States of America'],
    utmCampaigns: ['community_usa', 'wa_community_us'],
    shortioTag: 'community-usa',
  },
  {
    slug: 'australia',
    name: 'Australia',
    label: 'Australia',
    flag: '🇦🇺',
    sheetCountry: ['Australia', 'AUS', 'AU'],
    utmCampaigns: ['community_aus', 'wa_community_aus'],
    shortioTag: 'community-aus',
  },
  {
    slug: 'canada',
    name: 'Canada',
    label: 'Canada',
    flag: '🇨🇦',
    sheetCountry: ['Canada', 'CA', 'CAN'],
    utmCampaigns: ['community_canada', 'wa_community_ca'],
    shortioTag: 'community-canada',
  },
  {
    slug: 'germany',
    name: 'Germany',
    label: 'Germany',
    flag: '🇩🇪',
    sheetCountry: ['Germany', 'DE', 'Deutschland'],
    utmCampaigns: ['community_germany', 'wa_community_de'],
    shortioTag: 'community-germany',
  },
];

export const GROUP_SLUGS: GroupSlug[] = GROUPS.map((g) => g.slug);

export function getGroup(slug: string): GroupConfig | undefined {
  return GROUPS.find((g) => g.slug === slug);
}

export function groupLabel(slug: GroupSlug): string {
  return getGroup(slug)?.label ?? slug;
}

export function isGroupSlug(value: unknown): value is GroupSlug {
  return typeof value === 'string' && GROUP_SLUGS.includes(value as GroupSlug);
}

/**
 * The lead-source buckets shown in the leads-by-source breakdown. A UTM source
 * or medium is matched case-insensitively against `match`; the first bucket
 * that matches wins, and anything unmatched falls into "Other".
 */
export const LEAD_SOURCE_BUCKETS: { label: string; match: string[] }[] = [
  { label: 'Instagram', match: ['instagram', 'ig', 'insta'] },
  { label: 'Refer a friend', match: ['refer', 'referral', 'raf', 'refer-a-friend'] },
  { label: 'Scholarship teams', match: ['scholarship', 'scholarships', 'scholarship_team'] },
  { label: 'Community banners', match: ['banner', 'banners', 'community_banner', 'site_banner'] },
];

export const OTHER_SOURCE_LABEL = 'Other';

/** Bucket a registration's UTM source/medium into a lead-source label. */
export function bucketSource(utmSource: string, utmMedium = ''): string {
  const haystack = `${utmSource} ${utmMedium}`.toLowerCase();
  for (const bucket of LEAD_SOURCE_BUCKETS) {
    if (bucket.match.some((token) => haystack.includes(token))) return bucket.label;
  }
  return OTHER_SOURCE_LABEL;
}

/** All bucket labels, in display order, with "Other" last. */
export const ALL_SOURCE_LABELS = [
  ...LEAD_SOURCE_BUCKETS.map((b) => b.label),
  OTHER_SOURCE_LABEL,
];

/** Match a country string from the sheet back to a group. */
export function groupForCountry(country: string): GroupSlug | null {
  const needle = country.trim().toLowerCase();
  if (!needle) return null;
  for (const group of GROUPS) {
    if (group.sheetCountry.some((c) => c.toLowerCase() === needle)) return group.slug;
  }
  return null;
}

/** Match a UTM campaign string back to a group. */
export function groupForCampaign(campaign: string): GroupSlug | null {
  const needle = campaign.trim().toLowerCase();
  if (!needle) return null;
  for (const group of GROUPS) {
    if (group.utmCampaigns.some((c) => c.toLowerCase() === needle)) return group.slug;
  }
  return null;
}
