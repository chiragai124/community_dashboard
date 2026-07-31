# amber Community Dashboard

Engagement and lead performance across amber's WhatsApp communities, in three
scopes selectable from the sidebar:

| Scope | What it covers |
|---|---|
| **Community #1** | The five destination groups — UK, USA, Australia, Canada, Germany |
| **Community #2** | `amber global aspirants #2 \| 2026 Intake` — its own report, not a group inside #1 |
| **Merged** | Both communities pooled together |

Manual weekly input plus two weekly file imports. **No WhatsApp API or bot is
used anywhere**, so there is no ban risk — and there are no API connections at
all: every number comes either from the weekly form or from a file you export
yourself and upload.

---

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

It works immediately with no configuration — there is nothing to configure. With
no saved entries the dashboard shows eight weeks of deterministic demo weekly
entries and labels them as demo, so you can see the real layout before typing
anything up.

Imported figures have **no demo mode**: those cards read `—` until you upload a
file. An invented traffic number costs more trust when discovered than an empty
card costs patience.

**Demo data is never written to disk.** Your first saved entry replaces the demo
history entirely, rather than being appended to it: once real entries exist the
demo banner clears, so any demo rows left behind would read as real numbers with
nothing marking them as invented. Trend charts therefore start sparse and fill in
week by week.

```bash
npm run build && npm start   # production
npm run typecheck            # tsc --noEmit
```

## The weekly routine

Three uploads per community, from the community's own page under **Import data**.
Nothing is fetched — no credentials, no API keys, no `.env.local`.

| Source | File | What it produces |
|---|---|---|
| **WhatsApp** | Chat export `.zip`, **one per group** | Members and growth, join source, activity level, topics, questions, sentiment |
| **GA4** | Reports snapshot `.csv` | Active users, new users, sessions |
| **Short.io** | Statistics workbook `.xlsx` | Total link clicks, clicks per link path |

**Only two figures are still typed**: poll responses and 1:1 DM counts. Both are
absent from every export — WhatsApp carries a poll's *question* but never its
votes, and a group export contains no DM threads at all. Everything else on every
page is computed.

Short.io and GA4 are filed against a **week**. A chat export is filed against a
**group** and carries its own history, so one upload backfills every week it
covers; re-uploading replaces that group's record outright.

### Exporting from WhatsApp

1. Open the group in WhatsApp.
2. Tap the group name → scroll down → **Export chat**.
3. Choose **Without media** — media is not read and only makes the file huge.
4. Save the `.zip` to your computer and upload it against the right group.

Upload the **full history**, not a trimmed file. The export contains no member
list, so an absolute member count is only possible when the file reaches the
group's creation. Without that you still get net change per week, and the import
panel says which you got.

### Exporting from GA4

1. analytics.google.com → pick the property.
2. **Reports → Reports snapshot**.
3. Date range (top right) → the Monday–Sunday week.
4. **Share** icon → **Download file** → **Download CSV**.

### Exporting from Short.io

1. short.io → **Statistics**.
2. Set the date range to the same week.
3. **Export** → **Excel / .xlsx**. Upload unopened — the sheet names are what the
   reader matches on.

## What can and cannot be derived

Being explicit, because three things people reasonably expect are simply not in
these files:

| Metric | Source | Notes |
|---|---|---|
| Members, growth | WhatsApp | Absolute count needs an export reaching group creation; otherwise net change only |
| Join source | WhatsApp | **Invite link vs added by an admin.** WhatsApp never records *which* link was clicked, so a Short.io-vs-landing-page split is not recoverable |
| Activity level | WhatsApp | Message volume against that group's own median week |
| Topics | WhatsApp | Term and phrase frequency, counted per message. Frequency, not a summary of meaning |
| Questions | WhatsApp | Messages containing "?", grouped by near-duplicate |
| Sentiment | WhatsApp | **Keyword-based**, with negation and emoji handling. No model is involved; the panel reports what share of messages contained a word it recognises |
| Active users, new users, sessions | GA4 | |
| Link clicks, clicks per path | Short.io | |
| **Poll response rate** | **typed** | Votes are not in the export |
| **DM reply rate** | **typed** | A group export contains no DMs |
| **Leads, and leads by university/country** | **typed** | Nothing in the three files identifies a person, and no file carries a university. A WhatsApp join is a member, not a registration |

## Privacy

The dashboard now processes real chat content, so this matters more than the rest.

**The upload is never written to disk.** Every file — `.zip`, `.csv`, `.xlsx` — is
parsed in memory and discarded. No transcript is retained.

**What is stored**, in `data/whatsapp.json`:

- Counts: members, joins by mechanism, departures, messages, distinct posters
- Topic terms with message counts, and question text with how often each was asked
- Sentiment percentages, and **up to three verbatim example messages per
  sentiment per week** — real student messages, kept because example quotes were
  asked for
- Diagnostics about the file, with names redacted (see below)

**What is not stored**: the transcript, sender names, phone numbers. Distinct
posters are counted in memory and only the number is kept — deliberately not
hashed, since a stored hash of a phone number is still a stable identifier.

Diagnostic samples of unrecognised system lines are **name-redacted** before
storage: `"Priya Sharma changed this group's icon"` is stored as
`"[name] changed this group's icon"`. Over-redaction is the safe direction and the
phrasing is what makes the sample useful.

**Keeping it private on your machine:**

- `data/` is gitignored, so nothing can reach the repository by accident.
- Nothing in the codebase makes an outbound request — no export endpoint, no
  telemetry, no API calls anywhere.
- Your exposure is therefore exactly *whoever can read this disk*. Run it locally
  rather than on a shared host, keep the directory inside an encrypted home folder
  (FileVault / BitLocker / LUKS), and do not deploy it to a URL without auth in
  front — it has none.
- To keep zero verbatim text, delete the sentiment example quotes: they are the
  only free text stored. Say the word and I will drop them and keep only the
  percentages.
- `rm data/whatsapp.json` removes everything chat-derived; re-uploading rebuilds it.

### Structure — all in one file

Communities and their groups live in [`lib/groups.ts`](lib/groups.ts). Nothing
else defines them.

```ts
// Per community: which exports it can import.
{ slug: 'community-1', imports: ['shortio', 'ga4'], … }
{ slug: 'community-2', imports: ['shortio', 'ga4'], … }

// Per group: identity and a demo profile. No import configuration —
// imported figures are community-level, not per group.
{
  slug: 'aspirants-2026',
  community: 'community-2',
  label: 'Community-wide',
  demo: { members: 610, growth: 0.068 },
}
```

Declaring a source only *offers* the import control. Whether a figure appears for
a given week depends on whether a file has actually been uploaded for it — which
is why an unimported week reads `—` rather than `0`. That distinction is enforced
all the way down: `null` means "no file for this week", `0` means "the file said
zero", and they never render the same.

Group slugs are globally unique across communities, so a stored weekly entry
needs no community column — the group identifies it.

Column and sheet matching ignores case, spaces and punctuation, and each figure
has several accepted labels — so Short.io renaming "Total clicks" to "Clicks", or
GA4 labelling its dimension "Session source / medium" instead of "Session
source", does not break a weekly upload. The accepted names live in
[`lib/imports/shortio.ts`](lib/imports/shortio.ts) and
[`lib/imports/ga4.ts`](lib/imports/ga4.ts). **Add a label there rather than
editing an export to suit the code.**

The `.xlsx` reader is hand-written ([`lib/xlsx.ts`](lib/xlsx.ts)): an xlsx is a
ZIP of XML parts, and Node's zlib supplies the only hard part, so two numbers
don't need a spreadsheet dependency. It reads cells as strings and nothing else —
no formulas, styles or merged-cell geometry.

### Adding segments to Community #2

Community #2 currently has a single community-wide segment, because its real
subdivisions (if any) aren't known yet. To add them:

1. Add each new slug to `GroupSlug` in [`lib/types.ts`](lib/types.ts).
2. Copy the segment object in `COMMUNITY_2_GROUPS` and set `slug` and `label`.

That's it. Overview cards, the comparison table, trends, the entry form and the
merged roll-up all pick them up with no further changes, and the Comparison page
appears automatically once a community has two or more groups.

### What Community #2 needs from you

Nothing is required to run it. To make it real, provide any of these:

| What | Where it goes | Notes |
|---|---|---|
| **Its segments**, if it has any | `COMMUNITY_2_GROUPS` | Names only; I'll wire them up |
| **Current member count** | the weekly form | Or a starting number and I'll seed it |
| **Weekly history**, if you have it | the weekly form, one week at a time | Member count, polls, DMs sent/replies, activity, notes |
| **This week's exports** | Import data, on the Community #2 page | Short.io `.xlsx` and GA4 `.csv` |

The weekly entry format is identical for both communities, so there's nothing new
to learn: member count, poll question + option counts, DMs sent, DM replies,
activity level, notes.

## Leads

Leads are hand-entered — there is no registrations import. Each carries a name,
email, phone, university and country, and is filed against a group and a week.
`/c/<community>/leads` shows the total, leads this week, distinct universities and
countries, a leads-per-week line, and breakdowns by university and by country.

Two entry modes, because both are real: one lead at a time for a DM enquiry, or
**paste a block** straight from a spreadsheet for a batch. The paste is
tab-separated by default (what a spreadsheet actually puts on the clipboard) and
falls back to commas. If the first row looks like column names it is used to map
the columns, so a different column order still lands correctly; without one the
order is Name, Email, Phone, University, Country, and the app says which it used.
Re-pasting rows you already saved **updates** them rather than duplicating —
email is the key, falling back to name plus week.

Blank values are excluded from the breakdowns rather than bucketed as "Unknown",
and the count of leads missing a university or country is stated beneath each
chart. A bar labelled Unknown would compete with real universities and read as
though it were one.

### Personal data

`data/leads.json` holds names, email addresses and phone numbers, and the
sentiment examples in `data/weekly-entries.json` are quoted student messages.
Both paths are gitignored, so neither can reach the repository by accident, and
nothing in the app transmits them anywhere — there is no export endpoint and no
outbound request. They are as private as the machine running the dashboard.

There is deliberately **no demo mode for leads**: fabricated names and email
addresses would be indistinguishable from real ones once saved.

## Where imported figures are stored

`data/imports.json` (gitignored), one small record per uploaded file: the source,
community, week, filename, the extracted numbers, and a note per figure saying
where in the file it was found. Small enough to read and correct by hand.

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

Typed weekly, per group (about a minute each):

| Field | Shape |
|---|---|
| Member count | number — pre-filled from last week |
| Polls | question → option → count, any number of polls |
| 1:1 DMs sent / DM replies | numbers |
| Activity level | Low / Medium / High |
| **Activity note** | free text, sits beside the level — *why* it's that level |
| **Main topics** | comma-separated tags, e.g. `Scholarships, Visa process, IELTS` |
| **Common student questions** | one per line |
| **Content response** | free text — how students reacted to what you posted |
| Notes / observations | free text |

**Main topics are always visible** on each group's card and detail page, per
group — "what was this channel talking about" is the question a card is most often
opened to answer, and it was invisible while it lived behind a click. The
remaining qualitative fields (common questions, content response, activity note)
stay in a **collapsed-by-default expandable section**, so the card view stays
compact. That section renders nothing at all when a week has none of them filled
in, and the activity note also appears next to the level badge in the group
header. Unlike the
member count, none of these carry over from last week — a stale topic list would
read as a fresh observation.

Everything below is computed in [`lib/metrics.ts`](lib/metrics.ts) and is never
hand-entered:

- Week-over-week member growth %
- New members (delta against last week's count, overridable)
- Poll response rate % — responses ÷ member count
- DM reply rate % — replies ÷ DMs sent

**Sentiment** is typed, not computed. Enter the share of messages that were
positive, neutral and negative, plus up to three example messages for each. The
percentages are stored exactly as typed and are **never normalised to 100** — if
they don't add up, the form says so as you type and the panel states how much is
accounted for. Silently rescaling would present a data-entry slip as a finding.

**New members by source** is also typed, for a reason worth stating: Short.io
reports clicks and GA4 reports sessions, and **neither is a join**. Apportioning
growth by click share would invent a number that looks authoritative, so the
split is three hand-entered counts (WhatsApp link / landing page / organic-other).
The form checks the split against the week's new-member figure and warns on a
mismatch; it still saves, and the chart shows the split as entered rather than
adjusting either figure to fit the other.

Alongside it, the community overview shows new members, link clicks and sessions
as **three separate panels** over the same weeks. Three panels rather than one
chart because the units differ: a shared y axis would be meaningless and a second
axis would invite reading a crossing point as a relationship. They are context,
not a breakdown — the breakdown is the hand-entered split.

Imported figures are read straight out of the uploaded files and are not derived
from anything: total link clicks and clicks per link path (Short.io), active
users, new users and sessions (GA4). They are shown per community and, on the
merged view, summed across the communities that have an upload for that week — a
community with no file contributes nothing rather than a zero.

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

- **Overview** — pooled member/poll/DM totals, then this week's **imported
  figures** (active users, new users, sessions, link clicks) with clicks by link,
  the **Import data** panel, the community's groups side by side, this week's
  notes, and which groups still need an entry.
- **Group detail** (one per group) — weekly stat cards with sparklines, member and
  poll-rate trends, full poll history, and the weekly entry form. No imported
  figures here: they are community-level, so putting them on a group page would
  imply a per-group split that the exports don't contain.
- **Comparison** — the community's groups as rows, every metric as a sortable
  column, plus a member-growth overlay. Hidden for a community with one group,
  since there is nothing to compare.
- **Trends** — any metric over 4 or 8 weeks, overlaid, as small multiples, or one
  group at a time.

**Merged** — `/merged`:

- **Combined overview** — total members, poll response rate and DM reply rate
  pooled across both communities, the imported figures summed across them, then a
  roll-up card per community and a member-growth chart with one line per
  community.
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
