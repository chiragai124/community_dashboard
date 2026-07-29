# amber Community Dashboard

Engagement and lead performance across amber's five WhatsApp communities — **UK,
USA, Australia, Canada, Germany**.

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

### Attributing rows to groups

All the join keys live in one place, [`lib/groups.ts`](lib/groups.ts):

```ts
{
  slug: 'uk',
  sheetCountry: ['UK', 'United Kingdom', 'GB', …],  // matches the sheet's country column
  utmCampaigns: ['community_uk', 'wa_community_uk'], // matches GA4 + sheet campaigns
  shortioTag: 'community-uk',                        // tag on the group's Short.io links
}
```

Edit those to match your actual sheet values, UTM naming and Short.io tags.
Nothing else reads them. Sheet **columns are matched by header name, not
position**, so the sheet can be reordered freely (aliases are listed in
`.env.example`).

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
averaging five percentages: averaging would weight a 274-member group the same as
an 1,130-member one.

## Pages

- **Overview** — all five groups side by side: members, new members, activity
  level, leads this week. Plus pooled totals, this week's notes, and which groups
  still need an entry.
- **Group detail** (one per group) — weekly stat cards with sparklines, leads by
  source, GA4 traffic trend, member and poll-rate trends, full poll history, and
  the weekly entry form.
- **Comparison** — all five groups as rows, every metric as a sortable column,
  plus a member-growth overlay across all five.
- **Trends** — any metric over 4 or 8 weeks, viewed as all five overlaid, as
  small multiples, or one group at a time.

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
  page.tsx                  Overview
  group/[slug]/page.tsx     Group detail
  comparison/page.tsx       Cross-community table + overlay
  trends/page.tsx           Metric explorer
  api/entries/              GET / POST weekly entries, DELETE by id
  api/refresh/              POST forces a re-pull of all three sources
  globals.css               The whole design system
lib/
  groups.ts                 The 5 groups + all join keys and source buckets
  types.ts                  Shared types
  weeks.ts                  Monday-anchored week maths, all in UTC
  store.ts                  JSON-file / Supabase persistence
  metrics.ts                Every derived metric and formatter
  dashboard.ts              The one loader every page uses
  demo.ts                   Deterministic demo data (seeded, never random)
  integrations/             sheets · ga4 · shortio · cache
components/                 Charts, stat tiles, tables, the entry form
supabase/schema.sql         Table for the Supabase backend
```

Weeks are Monday→Sunday, identified by the Monday as `YYYY-MM-DD`, and all week
maths is done in UTC so a viewer's timezone can never shift an entry into the
wrong week.
