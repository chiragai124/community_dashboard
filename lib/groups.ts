import type {
  CommunityConfig,
  CommunitySlug,
  GroupConfig,
  GroupSlug,
  ImportSource,
  ScopeSlug,
} from './types';

/**
 * The tracked communities and their groups.
 *
 * This file is the single source of truth for structure. Adding a group — or a
 * whole community — is an edit here and nowhere else.
 *
 * Group slugs are globally unique across communities, so a stored weekly entry
 * needs no community column: the group identifies it.
 *
 * Each community also declares which exports it can import. Imported figures are
 * community-level (one Short.io file and one GA4 file per week), so groups carry
 * no import configuration of their own.
 */

/* -------------------------------------------------- Community #1 — 5 groups */

const COMMUNITY_1_GROUPS: GroupConfig[] = [
  {
    slug: 'uk',
    community: 'community-1',
    name: 'United Kingdom',
    label: 'UK',
    flag: '🇬🇧',
    demo: {
      members: 842,
      growth: 0.041,
    },
  },
  {
    slug: 'usa',
    community: 'community-1',
    name: 'United States',
    label: 'USA',
    flag: '🇺🇸',
    demo: {
      members: 1130,
      growth: 0.052,
    },
  },
  {
    slug: 'australia',
    community: 'community-1',
    name: 'Australia',
    label: 'Australia',
    flag: '🇦🇺',
    demo: {
      members: 468,
      growth: 0.031,
    },
  },
  {
    slug: 'canada',
    community: 'community-1',
    name: 'Canada',
    label: 'Canada',
    flag: '🇨🇦',
    demo: {
      members: 396,
      growth: 0.058,
    },
  },
  {
    slug: 'germany',
    community: 'community-1',
    name: 'Germany',
    label: 'Germany',
    flag: '🇩🇪',
    demo: {
      members: 274,
      growth: 0.024,
    },
  },
];

/* ------------------------------------------- Community #2 — 2026 intake ---- */

/**
 * Community #2 is a single global cohort, so it starts with one community-wide
 * segment rather than invented subdivisions.
 *
 * TO ADD REAL SEGMENTS: copy the object below and give each a unique `slug`
 * (adding it to `GroupSlug` in lib/types.ts). Everything else — overview cards,
 * comparison table, trends, the entry form, the merged roll-up — picks them up
 * with no further changes. The Comparison page appears automatically once a
 * community has 2+ groups.
 */
const COMMUNITY_2_GROUPS: GroupConfig[] = [
  {
    slug: 'aspirants-2026',
    community: 'community-2',
    name: 'Community-wide',
    label: 'Community-wide',
    flag: '🌍',
    demo: {
      members: 610,
      growth: 0.068,
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
    // Declaring a source only offers the import control. Figures appear for a
    // week once a file has actually been uploaded for it.
    imports: ['shortio', 'ga4', 'whatsapp'],
    groups: COMMUNITY_1_GROUPS,
  },
  {
    slug: 'community-2',
    // The community's own name, exactly as it is written in WhatsApp.
    name: 'amber global aspirants #2 | 2026 Intake',
    label: 'Community #2',
    description: '2026 intake cohort, global',
    groupNoun: 'Segments',
    imports: ['shortio', 'ga4', 'whatsapp'],
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

/* ------------------------------------------------------ import declarations */

/** The exports a community can import. Empty = manual-only. */
export function importsFor(community: CommunitySlug): ImportSource[] {
  return getCommunity(community)?.imports ?? [];
}

/** Does this community offer this import? */
export function communityHasImport(
  community: CommunitySlug,
  source: ImportSource,
): boolean {
  return importsFor(community).includes(source);
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
