-- Manual weekly entries for the Amber Community Dashboard.
-- Run this once in the Supabase SQL editor, then set SUPABASE_URL and
-- SUPABASE_SERVICE_ROLE_KEY. Without those the app uses data/weekly-entries.json.
--
-- Group slugs are globally unique across communities, so there is no community
-- column: the group identifies which community an entry belongs to (the mapping
-- lives in lib/groups.ts). Adding a community therefore needs no migration —
-- only new slugs.
--
-- group_slug is deliberately NOT constrained to a fixed list. An enum-style
-- CHECK would have to be migrated every time a group or community is added, and
-- would reject valid rows until it was. Validation happens in the app, which
-- rejects any slug not present in lib/groups.ts.

create table if not exists public.weekly_entries (
  -- "<group>:<week_start>", so a re-submitted week updates instead of duplicating.
  id                   text primary key,
  group_slug           text not null,
  -- Always a Monday; the app snaps any date to its week start before saving.
  week_start           date not null,
  total_members        integer not null check (total_members >= 0),
  -- Null means "derive from the previous week's delta".
  new_members_override integer,
  -- [{ question, options: [{ label, count }] }]
  polls                jsonb not null default '[]'::jsonb,
  dms_sent             integer not null default 0 check (dms_sent >= 0),
  dm_replies           integer not null default 0 check (dm_replies >= 0),
  activity_level       text not null default 'Medium' check (activity_level in ('Low','Medium','High')),
  notes                text not null default '',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- One row per group per week. The app's upsert relies on this constraint.
  constraint weekly_entries_group_week_unique unique (group_slug, week_start)
);

create index if not exists weekly_entries_week_idx on public.weekly_entries (week_start desc);
create index if not exists weekly_entries_group_week_idx on public.weekly_entries (group_slug, week_start desc);

-- The dashboard talks to Supabase with the service-role key from the server
-- only, so RLS stays on with no public policies: nothing is reachable from a
-- browser with the anon key.
alter table public.weekly_entries enable row level security;

-- ---------------------------------------------------------------------------
-- MIGRATION — only if you ran an earlier version of this file
--
-- The first version constrained group_slug to the five Community #1 slugs:
--   check (group_slug in ('uk','usa','australia','canada','germany'))
-- That constraint rejects Community #2's segments. Drop it once:
--
--   alter table public.weekly_entries
--     drop constraint if exists weekly_entries_group_slug_check;
--
-- Nothing else changed, and no data needs rewriting.
-- ---------------------------------------------------------------------------
