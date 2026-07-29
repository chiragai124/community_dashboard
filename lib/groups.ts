import type {
  CommunityConfig,
  CommunitySlug,
  GroupConfig,
  GroupSlug,
  Registration,
  ScopeSlug,
} from './types';

/**
 * The tracked communities and their groups.
 *
 * This file is the single source of truth for structure AND for the join keys
 * against the three automated sources. Nothing else reads them, so adding a
 * group — or a whole community — is an edit here and nowhere else.
 *
 * Group slugs are globally unique across communities, so a stored weekly entry
 * needs no community column: the group identifies it.
 */

/* -------------------------------------------------- Community #1 — 5 groups */

const COMMUNITY_1_GROUPS: GroupConfig[] = [
  {
    slug: 'uk',
    community: 'community-1',
    name: 'United Kingdom',
    label: 'UK',
    flag: '🇬🇧',
    sheetCountry: ['UK', 'United Kingdom', 'GB', 'England', 'Scotland', 'Wales'],
    utmCampaigns: ['community_uk', 'wa_community_uk'],
    shortioTag: 'community-uk',
    demo: {
      members: 842,
      growth: 0.041,
      leads: 34,
      universities: ['University of Manchester', 'UCL', 'University of Leeds', 'Coventry University'],
    },
  },
  {
    slug: 'usa',
    community: 'community-1',
    name: 'United States',
    label: 'USA',
    flag: '🇺🇸',
    sheetCountry: ['USA', 'US', 'United States', 'United States of America'],
    utmCampaigns: ['community_usa', 'wa_community_us'],
    shortioTag: 'community-usa',
    demo: {
      members: 1130,
      growth: 0.052,
      leads: 41,
      universities: ['Arizona State University', 'NYU', 'Purdue University', 'UT Dallas'],
    },
  },
  {
    slug: 'australia',
    community: 'community-1',
    name: 'Australia',
    label: 'Australia',
    flag: '🇦🇺',
    sheetCountry: ['Australia', 'AUS', 'AU'],
    utmCampaigns: ['community_aus', 'wa_community_aus'],
    shortioTag: 'community-aus',
    demo: {
      members: 468,
      growth: 0.031,
      leads: 19,
      universities: ['University of Melbourne', 'Monash University', 'UNSW', 'RMIT'],
    },
  },
  {
    slug: 'canada',
    community: 'community-1',
    name: 'Canada',
    label: 'Canada',
    flag: '🇨🇦',
    sheetCountry: ['Canada', 'CA', 'CAN'],
    utmCampaigns: ['community_canada', 'wa_community_ca'],
    shortioTag: 'community-canada',
    demo: {
      members: 396,
      growth: 0.058,
      leads: 16,
      universities: ['University of Toronto', 'UBC', 'York University', 'Concordia University'],
    },
  },
  {
    slug: 'germany',
    community: 'community-1',
    name: 'Germany',
    label: 'Germany',
    flag: '🇩🇪',
    sheetCountry: ['Germany', 'DE', 'Deutschland'],
    utmCampaigns: ['community_germany', 'wa_community_de'],
    shortioTag: 'community-germany',
    demo: {
      members: 274,
      growth: 0.024,
      leads: 11,
      universities: ['TU Munich', 'RWTH Aachen', 'University of Stuttgart', 'TU Berlin'],
    },
  },
];

/* ------------------------------------------- Community #2 — 2026 intake ---- */

/**
 * Community #2 is a single global cohort, so it starts with one community-wide
 * segment rather than invented subdivisions.
 *
 * TO ADD REAL SEGMENTS: copy the object below, give each a unique `slug`
 * (add it to `GroupSlug` in lib/types.ts), and set its `utmCampaigns` /
 * `shortioTag`. Everything else — overview cards, comparison table, trends,
 * the entry form, the merged roll-up — picks them up with no further changes.
 * The Comparison page appears automatically once a community has 2+ groups.
 *
 * `sheetCountry` is empty on purpose: this community is global, so its
 * registrations are attributed by UTM campaign, never by country.
 */
const COMMUNITY_2_GROUPS: GroupConfig[] = [
  {
    slug: 'aspirants-2026',
    community: 'community-2',
    name: 'Community-wide',
    label: 'Community-wide',
    flag: '🌍',
    sheetCountry: [],
    utmCampaigns: ['community_aspirants_2026', 'wa_aspirants_2026'],
    shortioTag: 'aspirants-2026',
    demo: {
      members: 610,
      growth: 0.068,
      leads: 27,
      universities: [
        'University of Manchester',
        'Arizona State University',
        'University of Melbourne',
        'University of Toronto',
        'TU Munich',
      ],
    },
  },
];

/* ----------------------------------------------------------- the registry -- */

export const COMMUNITIES: CommunityConfig[] = [
  {
    slug: 'community-1',
    name: 'Community #1 — destination groups',
    label: 'Community #1',
    description: 'UK, USA, Australia, Canada and Germany',
    groupNoun: 'Groups',
    groups: COMMUNITY_1_GROUPS,
  },
  {
    slug: 'community-2',
    // The community's own name, exactly as it is written in WhatsApp.
    name: 'amber global aspirants #2 | 2026 Intake',
    label: 'Community #2',
    description: '2026 intake cohort, global',
    groupNoun: 'Segments',
    groups: COMMUNITY_2_GROUPS,
  },
];

/** Every group across every community, in display order. */
export const GROUPS: GroupConfig[] = COMMUNITIES.flatMap((c) => c.groups);

export const GROUP_SLUGS: GroupSlug[] = GROUPS.map((g) => g.slug);

export const COMMUNITY_SLUGS: CommunitySlug[] = COMMUNITIES.map((c) => c.slug);

/* --------------------------------------------------------------- lookups -- */

export function getGroup(slug: string): GroupConfig | undefined {
  return GROUPS.find((g) => g.slug === slug);
}

export function groupLabel(slug: GroupSlug): string {
  return getGroup(slug)?.label ?? slug;
}

export function isGroupSlug(value: unknown): value is GroupSlug {
  return typeof value === 'string' && GROUP_SLUGS.includes(value as GroupSlug);
}

export function getCommunity(slug: string): CommunityConfig | undefined {
  return COMMUNITIES.find((c) => c.slug === slug);
}

export function isCommunitySlug(value: unknown): value is CommunitySlug {
  return typeof value === 'string' && COMMUNITY_SLUGS.includes(value as CommunitySlug);
}

export function isScopeSlug(value: unknown): value is ScopeSlug {
  return value === 'merged' || isCommunitySlug(value);
}

/** The community a group belongs to. */
export function communityOf(slug: GroupSlug): CommunityConfig | undefined {
  const group = getGroup(slug);
  return group ? getCommunity(group.community) : undefined;
}

/** Groups belonging to one community, in display order. */
export function groupsOf(community: CommunitySlug): GroupConfig[] {
  return getCommunity(community)?.groups ?? [];
}

export function groupSlugsOf(community: CommunitySlug): GroupSlug[] {
  return groupsOf(community).map((g) => g.slug);
}

/** The default community — what "/" lands on. */
export const DEFAULT_COMMUNITY: CommunitySlug = COMMUNITIES[0].slug;

/**
 * Singular of a plural noun. Handles the "-ies" case, so "communities" becomes
 * "community" rather than "communitie".
 */
export function singularize(pluralNoun: string): string {
  if (/ies$/i.test(pluralNoun)) return pluralNoun.replace(/ies$/i, 'y');
  if (/s$/i.test(pluralNoun)) return pluralNoun.replace(/s$/i, '');
  return pluralNoun;
}

/**
 * "1 segment" / "3 segments". groupNoun is stored plural, so a count of one has
 * to be singularised — Community #2 currently has a single segment, and "1
 * segments" on screen looks like a bug because it is one.
 */
export function countNoun(count: number, pluralNoun: string): string {
  return `${count} ${count === 1 ? singularize(pluralNoun) : pluralNoun}`;
}

/* -------------------------------------------------------- lead attribution */

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

/**
 * The ONE group a registration counts towards.
 *
 * Campaign wins over country, and the result is exactly one group — which is
 * what keeps the merged roll-up honest. With two communities a member of the
 * 2026-intake cohort who lists "UK" as their destination would otherwise match
 * both that cohort (by campaign) and Community #1's UK group (by country), and
 * be counted twice in the combined totals.
 */
export function attributeRegistration(registration: Registration): GroupSlug | null {
  return (
    groupForCampaign(registration.utmCampaign) ?? groupForCountry(registration.country)
  );
}
