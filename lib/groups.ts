import type {
  CommunityConfig,
  CommunitySlug,
  GroupConfig,
  GroupSlug,
  IntegrationName,
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
 *
 * DATA-SOURCE ATTRIBUTION lives here too, on each community's `integrations`
 * list. Google Sheets, GA4 and Short.io all represent Community #2's traffic
 * and signups only — none of them feed Community #1, whose numbers are manual
 * weekly entries. When a future community starts getting fed by a source, add
 * the source name to its `integrations` and set its join keys; the integration
 * code reads only this file.
 */

/* -------------------------------------------------- Community #1 — 5 groups */

/**
 * NOTE: these groups keep their sheetCountry / utmCampaigns / shortioTag keys,
 * but the keys are INERT — Community #1 declares no `integrations`, so no
 * pulled row is ever attributed here. They stay in place so that if this
 * community ever gets its own sources, declaring them is the only change.
 */
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
 * registrations are attributed by UTM campaign, never by country. And because
 * this is currently the only Sheets-fed group, any sheet row with no matching
 * campaign still counts towards it (see attributeRegistration) — the whole
 * sheet IS this community's signups.
 *
 * `shortioTag` is the tag on the Short.io links themselves. It applies to
 * Short.io only — Sheets and GA4 rows are matched by campaign/country, never
 * by this tag.
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
    shortioTag: 'scholarship_teamB',
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
    // Manual-only: Sheets, GA4 and Short.io do NOT represent these groups, so
    // none of the pulled data is ever attributed to them.
    integrations: [],
    groups: COMMUNITY_1_GROUPS,
  },
  {
    slug: 'community-2',
    // The community's own name, exactly as it is written in WhatsApp.
    name: 'amber global aspirants #2 | 2026 Intake',
    label: 'Community #2',
    description: '2026 intake cohort, global',
    groupNoun: 'Segments',
    // All three automated sources represent this community's traffic/signups.
    integrations: ['sheets', 'ga4', 'shortio'],
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

/* ----------------------------------------------- data-source declarations -- */

/** The sources declared by a community. Empty = manual-only. */
export function integrationsFor(community: CommunitySlug): IntegrationName[] {
  return getCommunity(community)?.integrations ?? [];
}

/** Does this community declare this source? */
export function communityHasSource(
  community: CommunitySlug,
  source: IntegrationName,
): boolean {
  return integrationsFor(community).includes(source);
}

/** Does this group's community declare this source? */
export function groupHasSource(group: GroupSlug, source: IntegrationName): boolean {
  const config = getGroup(group);
  return config ? communityHasSource(config.community, source) : false;
}

/**
 * Every group whose community declares a source — the ONLY groups a pulled row
 * may be attributed to. Integration code fans out from this, so attribution
 * changes are config edits, never code edits.
 */
export function groupsWithSource(source: IntegrationName): GroupConfig[] {
  return GROUPS.filter((g) => communityHasSource(g.community, source));
}

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

/** Match a country string from the sheet back to a group among `candidates`. */
export function groupForCountry(
  country: string,
  candidates: GroupConfig[] = GROUPS,
): GroupSlug | null {
  const needle = country.trim().toLowerCase();
  if (!needle) return null;
  for (const group of candidates) {
    if (group.sheetCountry.some((c) => c.toLowerCase() === needle)) return group.slug;
  }
  return null;
}

/** Match a UTM campaign string back to a group among `candidates`. */
export function groupForCampaign(
  campaign: string,
  candidates: GroupConfig[] = GROUPS,
): GroupSlug | null {
  const needle = campaign.trim().toLowerCase();
  if (!needle) return null;
  for (const group of candidates) {
    if (group.utmCampaigns.some((c) => c.toLowerCase() === needle)) return group.slug;
  }
  return null;
}

/**
 * The ONE group a registration counts towards — or null when it counts nowhere.
 *
 * Two rules keep this honest:
 *
 * 1. Only groups whose community declares Sheets coverage are candidates. The
 *    sheet represents Community #2 signups only, so a row whose destination
 *    column says "UK" must NOT land in Community #1's UK group — that group's
 *    numbers are manual, and the pulled row doesn't describe it.
 * 2. Campaign wins over country, and the result is exactly one group, so a row
 *    can never be counted twice in the merged roll-up.
 *
 * When exactly one Sheets-fed group exists (today: Community #2's single
 * segment), rows with no matching campaign or country still count towards it —
 * the whole sheet belongs to that community, UTM-tagged or not. The moment a
 * second Sheets-fed group is configured this fallback stops, because an
 * unmatched row could no longer be placed truthfully.
 */
export function attributeRegistration(registration: Registration): GroupSlug | null {
  const candidates = groupsWithSource('sheets');
  if (candidates.length === 0) return null;

  const matched =
    groupForCampaign(registration.utmCampaign, candidates) ??
    groupForCountry(registration.country, candidates);
  if (matched) return matched;

  return candidates.length === 1 ? candidates[0].slug : null;
}
