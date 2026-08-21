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
 * Group slugs are globally unique across communities, so a stored WhatsApp
 * import needs no community column: the group identifies it.
 *
 * Each community also declares which exports it can import. Imported figures are
 * community-level (one Short.io file and one GA4 file per week), so groups carry
 * no import configuration of their own.
 */

/* -------------------------------------------------- Community #1 — 5 groups */

const COMMUNITY_1_GROUPS: GroupConfig[] = [
  { slug: 'uk', community: 'community-1', name: 'United Kingdom', label: 'UK', flag: '🇬🇧' },
  { slug: 'usa', community: 'community-1', name: 'United States', label: 'USA', flag: '🇺🇸' },
  { slug: 'australia', community: 'community-1', name: 'Australia', label: 'Australia', flag: '🇦🇺' },
  { slug: 'canada', community: 'community-1', name: 'Canada', label: 'Canada', flag: '🇨🇦' },
  { slug: 'germany', community: 'community-1', name: 'Germany', label: 'Germany', flag: '🇩🇪' },
];

/* ------------------------------------------- Community #2 — 2026 intake ---- */

/**
 * Same five destinations as Community #1, tracked as Community #2's own
 * segments — distinct slugs (`-2` suffix) since group slugs are globally
 * unique across communities.
 */
const COMMUNITY_2_GROUPS: GroupConfig[] = [
  { slug: 'uk-2', community: 'community-2', name: 'United Kingdom', label: 'UK', flag: '🇬🇧' },
  { slug: 'usa-2', community: 'community-2', name: 'United States', label: 'USA', flag: '🇺🇸' },
  { slug: 'australia-2', community: 'community-2', name: 'Australia', label: 'Australia', flag: '🇦🇺' },
  { slug: 'canada-2', community: 'community-2', name: 'Canada', label: 'Canada', flag: '🇨🇦' },
  { slug: 'germany-2', community: 'community-2', name: 'Germany', label: 'Germany', flag: '🇩🇪' },
];

/* ------------------------------------------- Community #3 — same 5 groups -- */

const COMMUNITY_3_GROUPS: GroupConfig[] = [
  { slug: 'uk-3', community: 'community-3', name: 'United Kingdom', label: 'UK', flag: '🇬🇧' },
  { slug: 'usa-3', community: 'community-3', name: 'United States', label: 'USA', flag: '🇺🇸' },
  { slug: 'australia-3', community: 'community-3', name: 'Australia', label: 'Australia', flag: '🇦🇺' },
  { slug: 'canada-3', community: 'community-3', name: 'Canada', label: 'Canada', flag: '🇨🇦' },
  { slug: 'germany-3', community: 'community-3', name: 'Germany', label: 'Germany', flag: '🇩🇪' },
];

/* ----------------------------------------------------------- the registry -- */

export const COMMUNITIES: CommunityConfig[] = [
  {
    slug: 'community-1',
    name: 'Community #1 — destination groups',
    label: 'Community #1',
    description: 'UK, USA, Australia, Canada and Germany',
    groupNoun: 'Groups',
    // GA4 isn't here: it's landing-page traffic, not any community's data —
    // see LANDING_PAGE_IMPORTS below. Short.io is Community #2's specifically
    // (its own link data), so Community #1 declares no imports of its own.
    imports: [],
    groups: COMMUNITY_1_GROUPS,
  },
  {
    slug: 'community-2',
    // The community's own name, exactly as it is written in WhatsApp.
    name: 'amber global aspirants #2 | 2026 Intake',
    label: 'Community #2',
    description: 'UK, USA, Australia, Canada and Germany',
    groupNoun: 'Segments',
    // Short.io is specifically Community #2's link data — not shared or
    // generic, and not offered on Community #1's or #3's page.
    imports: ['shortio'],
    groups: COMMUNITY_2_GROUPS,
  },
  {
    slug: 'community-3',
    name: 'Community #3',
    label: 'Community #3',
    description: 'UK, USA, Australia, Canada and Germany',
    groupNoun: 'Groups',
    imports: [],
    groups: COMMUNITY_3_GROUPS,
  },
];

/**
 * GA4 is landing-page traffic — not scoped to any community — so it isn't in
 * any `CommunityConfig.imports` array above. This is what the Landing page &
 * WADL page uses to render its one, unscoped GA4 panel.
 */
export const LANDING_PAGE_IMPORTS: ImportSource[] = ['ga4'];

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
  return value === 'merged' || value === 'overview' || isCommunitySlug(value);
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

/** The default community — kept for the group-detail page's breadcrumb fallback. */
export const DEFAULT_COMMUNITY: CommunitySlug = COMMUNITIES[0].slug;

/* ------------------------------------------------------ import declarations */

/** The exports a community can import. Empty = WhatsApp-only. */
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
