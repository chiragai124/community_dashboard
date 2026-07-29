# amber Community Dashboard

Engagement and lead performance across amber's WhatsApp communities, in three
scopes selectable from the sidebar:

| Scope | What it covers |
|---|---|
| **Community #1** | The five destination groups — UK, USA, Australia, Canada, Germany |
| **Community #2** | `amber global aspirants #2 \| 2026 Intake` — its own report, not a group inside #1 |
| **Merged** | Both communities pooled together |

Manual weekly input plus three automated pulls. **No WhatsApp API or bot is used
anywhere**, so there is no ban risk: every number comes either from an official
data source (Google Sheets, GA4, Short.io) or from the weekly form.

---

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

It works immediately with no configuration. With no credentials and no saved
entries, the dashboard runs on eight weeks of deterministic demo data and labels
it as demo on every affected surface — so you can see the real layout before
wiring anything up.

**Demo data is never written to disk.** Your first saved entry replaces the demo
history entirely, rather than being appended to it: once real entries exist the
demo banner clears, so any demo rows left behind would read as real numbers with
nothing marking them as invented. Trend charts therefore start sparse and fill in
week by week.

```bash
npm run build && npm start   # production
npm run typecheck            # tsc --noEmit
```

## Connect the real data

Copy `.env.example` to `.env.local` and fill in what you have. Each integration
degrades on its own, so you can connect them one at a time.

| Source | What it provides | Needs |
|---|---|---|
| **Google Sheets** | Registrations: name, email, country, university, UTM source/medium/campaign, timestamp | `GOOGLE_SHEETS_ID` + service-account credentials |
| **GA4 Data API** | Weekly sessions by campaign / source / medium | `GA4_PROPERTY_ID` + the same service account |
| **Short.io** | Click counts per tracked link, per group | `SHORTIO_API_KEY`, `SHORTIO_DOMAIN_ID` |

One Google service account covers both Google sources: share the sheet with its
email, and add that email as a Viewer on the GA4 property.

Data refreshes on page load once the cache is stale (10 minutes by default) and
on the **Refresh data** button in the page header. There is no realtime sync and
no background polling — by design.

### Structure and attribution — all in one file

Communities, their groups, and every join key against the three data sources live
in [`lib/groups.ts`](lib/groups.ts). Nothing else reads them.

```ts
{
  slug: 'uk',
  community: 'community-1',                          // which community it belongs to
  sheetCountry: ['UK', 'United Kingdom', 'GB', …],   // matches the sheet's country column
  utmCampaigns: ['community_uk', 'wa_community_uk'], // matches GA4 + sheet campaigns
  shortioTag: 'community-uk',                        // tag on the group's Short.io links
  demo: { members: 842, growth: 0.041, leads: 34, universities: […] },
}
```

Group slugs are globally unique across communities, so a stored weekly entry
needs no community column — the group identifies it. Sheet **columns are matched
by header name, not position**, so the sheet can be reordered freely (aliases are
listed in `.env.example`).

**Attribution is exclusive.** Each registration counts towards exactly one group:
UTM campaign first, then country. This matters with two communities — a
2026-intake member who lists "UK" as their destination would otherwise match both
that cohort (by campaign) and Community #1's UK group (by country), and be
counted twice in the merged totals.

### Adding segments to Community #2

Community #2 currently has a single community-wide segment, because its real
subdivisions (if any) aren't known yet. To add them:

1. Add each new slug to `GroupSlug` in [`lib/types.ts`](lib/types.ts).
2. Copy the segment object in `COMMUNITY_2_GROUPS` and set `slug`, `label`,
   `utmCampaigns` and `shortioTag`.

That's it. Overview cards, the comparison table, trends, the entry form and the
merged roll-up all pick them up with no further changes, and the Comparison page
appears automatically once a community has two or more groups. `sheetCountry` is
empty for this community on purpose — it's global, so its registrations are
attributed by campaign, never by country.

### What Community #2 needs from you

Nothing is required to run it — it ships with demo data like everything else. To
make it real, provide any of these:

| What | Where it goes | Notes |
|---|---|---|
| **Its segments**, if it has any | `COMMUNITY_2_GROUPS` | Names only; I'll wire them up |
| **UTM campaign name(s)** | `utmCampaigns` | The exact string in GA4 / the sheet's campaign column |
| **Short.io tag** | `shortioTag` | The tag on that community's tracked links |
| **Current member count** | the weekly form | Or a starting number and I'll seed it |
| **Weekly history**, if you have it | the weekly form, one week at a time | Member count, polls, DMs sent/replies, activity, notes — same format as Community #1 |

The weekly entry format is identical for both communities, so there's nothing new
to learn: member count, poll question + option counts, DMs sent, DM replies,
activity level, notes.

Lead-source buckets — Instagram, refer-a-friend, scholarship teams, community
banners — are also defined in `lib/groups.ts` (`LEAD_SOURCE_BUCKETS`). Anything
unmatched falls into "Other".

## Where weekly entries are stored

Default: a JSON file at `data/weekly-entries.json` (gitignored). No setup, and
fine for five rows a week.

To use Supabase instead, run [`supabase/schema.sql`](supabase/schema.sql) and set
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. The app switches automatically —
same four functions, so pages never know which backend is live
([`lib/store.ts`](lib/store.ts)).

`group + weekStart` is the natural key, so re-submitting a week edits it rather
than creating a duplicate. Any date is snapped to its Monday before saving, so a
mid-week date can never create a second row for the same week.

## What is typed vs. calculated

Typed weekly, per group (about a minute each): member count, polls (question →
option → count), 1:1 DMs sent, DM replies, activity level, notes.

Everything below is computed in [`lib/metrics.ts`](lib/metrics.ts) and is never
hand-entered:

- Week-over-week member growth %
- New members (delta against last week's count, overridable)
- Poll response rate % — responses ÷ member count
- DM reply rate % — replies ÷ DMs sent
- Registrations-to-clicks conversion per source
- Total leads this week (Sheet, filtered by group)
- Total site traffic this week (GA4, filtered by the group's UTM campaign)

The form pre-fills last week's member count so you only edit the delta, defaults
activity to last week's choice, and shows every derived rate live as you type.
DM counts are *not* pre-filled — a stale DM number would silently become a wrong
data point — but last week's volume is shown as placeholder text.

Rates in roll-ups are computed from summed numerators and denominators, not by
averaging percentages: averaging would weight a 274-member group the same as an
1,130-member one, and would be wrong again in the merged view, where a
969-member cohort would pull the combined rate as hard as a 4,398-member
community. This holds at every level — group, community, and merged — including
the per-week values behind the merged trend chart.

## Pages

The sidebar has two levels: a scope switcher (Community #1 / Community #2 /
Merged), then the navigation for whichever scope is selected. Scope is read from
the URL, so any view can be linked to directly.

**Per community** — `/c/community-1`, `/c/community-2`:

- **Overview** — the community's groups side by side (members, new members,
  activity level, leads), its pooled totals, this week's notes, and which of its
  groups still need an entry.
- **Group detail** (one per group) — weekly stat cards with sparklines, leads by
  source, GA4 traffic trend, member and poll-rate trends, full poll history, and
  the weekly entry form.
- **Comparison** — the community's groups as rows, every metric as a sortable
  column, plus a member-growth overlay. Hidden for a community with one group,
  since there is nothing to compare.
- **Trends** — any metric over 4 or 8 weeks, overlaid, as small multiples, or one
  group at a time.

**Merged** — `/merged`:

- **Combined overview** — total members, leads this week, poll response rate and
  DM reply rate pooled across both communities, then a roll-up card per community
  and a member-growth chart with one line per community.
- **All groups** — every group from both communities in one sortable table with a
  community column, plus per-community subtotals.
- **Trends** — the same metrics at community level, one series per community.

Old URLs (`/group/uk`, `/comparison`, `/trends`) redirect to their Community #1
equivalents, so existing links keep working.

## Design notes

Black (`#0a0a0a`) chrome, white/light-grey content surfaces, and `#ed3a56` as the
single accent. No other accent colour is defined anywhere in `app/globals.css`.

Chart colours were validated rather than eyeballed, against the white chart
surface:

| Token | Hex | Contrast | Role |
|---|---|---|---|
| Accent | `#ed3a56` | 3.93:1 | data marks (clears the 3:1 floor) |
| Context | `#8d94a1` | 3.05:1 | de-emphasised series, still clears 3:1 |
| Accent ink | `#c22740` | 5.74:1 | the only accent used as small text |

`#ed3a56` is below the 4.5:1 text floor, so it is used for marks and large
figures only — never body-size text.

**Five series, one accent.** Hue cannot separate five lines when only one accent
exists, so it doesn't try to. The multi-group chart draws every line in the
recessive grey and the selected one in the accent on top, with direct end labels
and a clickable legend carrying identity. End labels that would collide are
dropped rather than stacked (the legend still names them). The small-multiples
view shares one y scale across all five panels, so panel heights are directly
comparable.

Other rules held throughout: one y-axis per chart (never dual), 2px lines, bars
capped well under 24px with a 4px rounded data end, hairline solid gridlines,
markers with a 2px surface ring, labels only at line ends, and text in ink tokens
rather than the series colour.

## Layout

```
app/
  page.tsx                        Redirects to the first community
  c/[community]/page.tsx          Community overview
  c/[community]/group/[slug]/     Group detail
  c/[community]/comparison/       Cross-group table + overlay
  c/[community]/trends/           Metric explorer
  merged/page.tsx                 Combined overview, both communities
  merged/comparison/              Every group + community subtotals
  merged/trends/                  Metrics at community level
  group/[slug], comparison/,      Legacy redirects to Community #1
    trends/
  api/entries/              GET / POST weekly entries, DELETE by id
  api/refresh/              POST forces a re-pull of all three sources
  globals.css               The whole design system
lib/
  groups.ts                 Communities, groups, join keys, source buckets
  types.ts                  Shared types
  weeks.ts                  Monday-anchored week maths, all in UTC
  store.ts                  JSON-file / Supabase persistence
  metrics.ts                Every derived metric and formatter
  dashboard.ts              The one loader every page uses, plus roll-ups
  demo.ts                   Deterministic demo data (seeded, never random)
  integrations/             sheets · ga4 · shortio · cache
components/                 Charts, stat tiles, tables, the entry form
supabase/schema.sql         Table for the Supabase backend
```

Weeks are Monday→Sunday, identified by the Monday as `YYYY-MM-DD`, and all week
maths is done in UTC so a viewer's timezone can never shift an entry into the
wrong week.
