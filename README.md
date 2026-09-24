# amber Communities · Weekly Engagement Report

A weekly report across amber's WhatsApp communities, built from uploaded
exports plus a handful of figures you type by hand.

**One report, one date range.** Every section of the dashboard — member
counts, leads, Instagram, WhatsApp, Short.io, GA4 — answers for the same
period, chosen once at the top of the page. Each filed report is kept as its
own record, so browsing back to an earlier one shows what it said at the
time, and every "vs. last report" figure is measured against the previous
record rather than re-typed.

| Tab | What it shows |
|---|---|
| **Overview** | Member count table, Instagram broadcast channel, accommodation poll & follow-up funnel, messages by community, the Landing page & WADL dashboard, headline takeaways |
| **Community #1–#4** | Headline stats, the batch chat-export upload, manual "Total members" and "Leads added" entries, a messages-by-group bar chart, a snapshot card per group, and a community-wide "Main topics discussed" + narrative synthesis |
| **Landing page & WADL** | The full-width traffic/clicks dashboard, plus the GA4 and Short.io uploads that feed it |

Each group's own page (one click from its snapshot card) has the full
sentiment breakdown and a single-file upload fallback.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
npm run build && npm start   # production
npm run typecheck            # tsc --noEmit
```

Every card reads `—`/`0` until something real is filed — there is no
demo/fabricated data anywhere in this app.

## The routine

1. Open a **Community tab** and drop that community's chat exports into the
   import panel — **all of its groups at once**.
2. Set the report's start and end date. Those dates become the reporting
   period for the whole dashboard.
3. Upload this period's **GA4** snapshot and **Short.io** workbook on the
   Landing page tab (or skip it — see [Skipping an
   upload](#skipping-an-upload)).
4. Enter the three hand-typed figures: each community's **total members**
   and **leads added**, and the **Instagram channel's** member count.

Everything else is computed.

### Uploading a whole community at once

The community import panel takes every group's export in one go and works
out which file belongs to which group **from the export itself** — no
tagging, no dropdowns. It reads, in order of trust:

1. the chat's own group name, from the `created group "…"` and
   `changed the subject to "…"` lines in the transcript (a renamed group
   resolves to the name it has now);
2. the `.txt` entry's name inside a "with media" `.zip`
   (`WhatsApp Chat with …`);
3. the uploaded filename.

Each candidate is matched against the five destinations that community
tracks, as whole words — "us" appears inside "aspirants" and "can" inside
"cancelled", so substring matching would file half the uploads under the
USA. A name mentioning two destinations ("UK vs USA comparison") is treated
as ambiguous and skipped rather than guessed at.

Afterwards every file is listed with the group it matched **and the evidence
that matched it**, so a wrong guess is visible and correctable instead of
silent. A file that couldn't be matched is reported on its own and the rest
of the batch still goes through. For the rare export that nothing can
identify, each group's own page has a single-file upload where the group is
pinned explicitly.

See [`lib/imports/detect-group.ts`](lib/imports/detect-group.ts).

### Exporting from WhatsApp

1. Open the group in WhatsApp, tap the group name to open **Group info**.
2. Scroll down and tap **Export chat**, then choose **Include media** or
   **Without media** — both work; upload the resulting `.zip` or `.txt`
   directly, no manual unzipping needed.
3. Repeat per group, then select all of the saved files together. Keep
   WhatsApp's own filenames where you can — they carry the group name.

With media, only the chat `.txt` inside the `.zip` is read. Every photo,
video and voice note in the archive is left compressed and untouched. A
"with media" export is capped at 80MB (25MB for text-only `.txt` uploads),
and at most 12 files per batch.

From messages inside your chosen range only:

- **Messages this period**, **unique active chatters**, **top voices** (by
  message count).
- **Activity level** (Low/Medium/High) — this report's message count vs. the
  group's own previous filed report, not a fixed threshold.
- **Main topics** — the period's most frequent non-filler words, title-cased.
  A local word-frequency heuristic, not LLM-generated.
- **Sentiment** — a positive/neutral/negative split by a small bundled word
  list, plus up to three example messages per bucket.

All computed locally in
[`lib/imports/whatsapp.ts`](lib/imports/whatsapp.ts) — no network call, no
API key, nothing sent anywhere.

## Skipping an upload

If no Short.io or GA4 export is uploaded for a period, the most recent
earlier one is reused. How faithful that is depends entirely on what the
file contains, and the panel always says which happened:

- **Re-sliced** — the export carried day-by-day rows (Short.io's per-day
  clicks sheet, a GA4 section broken down by date), so the figures really
  are this period's, summed from exactly the right days. Shown as an
  ordinary note.
- **Carried forward** — the export only had window totals, so the previous
  period's numbers stand in unchanged. Shown as a **warning**, because
  quietly reprinting last week's totals as if they were this week's is the
  exact failure this design exists to avoid.

The same slicing runs at upload time too: export a whole month and file the
current week out of it, and the stored figure is that week's, not the
month's. See [`lib/imports/resolve.ts`](lib/imports/resolve.ts).

## Filed reports, and "vs. last report"

Every date range that has anything filed against it becomes a **report
record** — the range plus the numbers that were true for it. Records are
keyed by range and never overwritten by a later report; the picker at the
top of every page browses them.

Records are refreshed whenever something is uploaded or entered *for that
same period*, so a report can't drift from its own inputs, and never on page
load, so reading the dashboard never writes to it. Once the active period
moves on, the record is settled — and every "vs. last report" figure on the
next report reads from it. Nobody re-enters last week's numbers.

Opening a past report is read-only: it shows that report, with an
unmissable banner, while new uploads and entries still go to the current
period.

See [`lib/reports.ts`](lib/reports.ts).

## What's typed by hand, and why

Three figures, none of which any export contains:

- **Total members**, per community. A WhatsApp export doesn't reliably
  contain a group's *full* join/leave history, so replaying it to compute a
  total silently undercounts.
- **Leads added to the CRM**, per community. A chat export contains
  conversations, not outcomes.
- **The Instagram broadcast channel's member count**, plus a one-time
  creation date.

Each is an append-only dated log ([`lib/entry-log.ts`](lib/entry-log.ts)),
so a past report keeps the figure that was true when it was filed rather
than silently adopting whatever has been entered since. The as-of date
defaults to the end of the period being reported on, not to today — entering
Monday's numbers on Wednesday should file them against Monday's report.

**Members are a level, leads are a flow.** A member total carries forward:
last month's reading is still the best answer until a new one arrives. A
leads figure does not — carrying it forward would report the same leads
again in every subsequent report, inflating the funnel indefinitely. A
period with no leads entered shows none, and says so.

## The external calls: Groq

Groq's free-tier chat completions API ([`lib/ai/groq.ts`](lib/ai/groq.ts))
is the one deliberate exception to "nothing leaves this machine", made with
the user's explicit sign-off. Set `GROQ_API_KEY` in `.env.local` (free at
[console.groq.com](https://console.groq.com)) — without it everything else
still works and the AI-written fields are simply omitted.

**Per group, automatic on upload** — that report's real chat text is sent to
generate a **status tag**, a **top-voices summary**, and a **narrative**
paragraph. A batch stops asking for summaries once it has spent two minutes
on them, so a slow run can't cost the exports that already parsed; the
response says how many got one.

**Per community and for the Overview, manual** — behind a "Regenerate"
button, since both depend on several groups' reports having settled first
(and firing on every page load would be an unbounded number of calls).
These synthesise the already-generated summaries, not raw chat text — no
additional message content is sent.

A failed or rate-limited call is swallowed in every case; the numeric
figures are already saved and usable either way. Chat text and message
senders are never persisted.

## Structure — all in one file

Communities and their groups live in [`lib/groups.ts`](lib/groups.ts).
Nothing else defines them. Adding a group or a whole community is an edit
there and nowhere else — group slugs are globally unique across communities,
so a stored WhatsApp import needs no community column of its own.

## Where data is stored

Small JSON documents holding a handful of numbers per upload or entry —
never the source files, and never their raw rows:

- `imports.json` — one record per uploaded file: source, community/group,
  the date range it covers, filename, the extracted figures, any day-by-day
  rows, and the per-group AI summary.
- `reports.json` — one filed report per date range, with its numbers.
- `active-period.json` — the date range every section currently reports on.
- `community-members.json`, `community-leads.json`,
  `instagram-members.json`, `instagram-channel.json` — the hand-entered
  figures and their dated history.
- `community-summaries.json` / `overview-takeaways.json` — the
  manually-generated AI summaries.

Nothing you upload — including the chat transcript itself — is ever kept as
a file; each is parsed in-process and discarded.

**Two backends** ([`lib/vercel-blob.ts`](lib/vercel-blob.ts)), chosen
automatically by whether `BLOB_READ_WRITE_TOKEN` is set:

- **Local disk** (`data/*.json`, gitignored) — the zero-config default for
  `npm run dev`.
- **Vercel Blob** — **required for any deploy target with a read-only
  filesystem, including Vercel**, since serverless functions there can't
  write to `data/` (only to `/tmp`, which is ephemeral and not shared across
  invocations). Create a Blob store once (Vercel dashboard → your project →
  Storage → Create Database → Blob) and connect it — `BLOB_READ_WRITE_TOKEN`
  is then injected automatically. Only small JSON documents are stored, and
  access defaults to `private` since they contain real names and quoted
  message snippets.

Reads pass `useCache: false`: Vercel's own docs note that a read immediately
after a write to the same blob path can return the *previous* version for up
to 60 seconds through the CDN cache, which is exactly the "uploaded fine,
but doesn't show up" symptom.

All of them are small enough to read and correct by hand.

## Layout

```
app/
  page.tsx                        Overview — the report's front page, in report order
  c/[community]/page.tsx          Community tab (batch upload, manual figures, snapshots)
  c/[community]/group/[slug]/     Group detail (sentiment, topics, single-file upload)
  merged/page.tsx                 Landing page & WADL (traffic + link clicks, and their uploads)
  group/[slug]/                   Legacy redirect to the community-scoped group URL
  api/imports/                    POST exports (a WhatsApp batch, or one Short.io/GA4 file)
  api/imports/reset/              POST — wipe every uploaded import, then refresh the reports
  api/period/                     POST { start, end } — change the active reporting period
  api/community-members/          POST { community, total, enteredAt? }
  api/community-leads/            POST { community, leads, enteredAt? }
  api/instagram/                  POST { members?, enteredAt?, createdOn? }
  api/ai/community-summary/       POST { community } — regenerate a community's AI synthesis
  api/ai/overview-takeaways/      POST — regenerate the Overview's AI takeaways
  globals.css                     The whole design system (red/paper)
lib/
  groups.ts                 Communities, groups — the single source of structure
  types.ts                  Shared types
  reports.ts                Filed reports, and the active reporting period
  entry-log.ts              The dated, append-only log every hand-entered figure uses
  community-members.ts      Per-community member-total history
  community-leads.ts        Per-community "leads added this period" history
  instagram.ts              The broadcast channel's creation date and member history
  period.ts                 Date-range maths for report periods
  weeks.ts                  Monday-anchored week maths, all in UTC
  zip.ts / xlsx.ts / csv.ts Minimal readers for the three export formats
  vercel-blob.ts            Vercel Blob read/write for the JSON stores
  metrics.ts                Every derived metric and formatter
  dashboard.ts              The one loader every page uses, plus roll-ups and report filing
  ai/groq.ts, ai/store.ts   The Groq calls and their caches
  imports/
    shortio.ts, ga4.ts      Short.io/GA4 file readers
    daily.ts                Finding a day-by-day breakdown inside an export
    resolve.ts              Which export answers for a period, and how faithfully
    detect-group.ts         Matching a chat export to its group
    period-match.ts         Which WhatsApp upload answers for a group in a period
    whatsapp.ts             The chat parser — message-level figures only
    store.ts                Persistence for every uploaded file's figures
components/                 Charts, stat tiles, snapshot cards, the batch upload panel,
                             the report-period picker, the Landing page & WADL dashboard,
                             the Overview's report sections, the hand-entry forms
```

All dates are computed in UTC, so a viewer's timezone can never shift a
message into the wrong report.
