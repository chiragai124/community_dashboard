# amber Communities · Weekly Engagement Report

A weekly report across amber's WhatsApp communities, built from uploaded
exports plus two things you type by hand: a report's date range per
WhatsApp upload, and each community's total member count.

| Tab | What it shows |
|---|---|
| **Overview** | Total members across every community, per-community member/message counts, two bar charts, a members-vs-previous-report comparison, and headline takeaways |
| **Community #1 / #2 / #3** | Headline stats, a manual "Total members" entry, a members-vs-previous-report comparison, a messages-by-group bar chart, a snapshot card per group (status tag, messages, active chatters, top voices), and one community-wide "Main topics discussed" + narrative synthesis |
| **Landing page & WADL** | GA4 landing-page traffic and Community #2's Short.io link data — untouched, still on the original weekly system |

Each group's own page (one click from its snapshot card) has the full
sentiment breakdown and the WhatsApp upload control.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
npm run build && npm start   # production
npm run typecheck            # tsc --noEmit
```

Every card reads `—`/`0` until a real WhatsApp report or member total is
filed — there is no demo/fabricated data anywhere in this app.

## Total membership is entered manually, not parsed

Earlier versions of this app replayed a chat export's own join/add/leave/
remove system messages to compute a member total. That undercounts: a
WhatsApp export doesn't reliably contain a group's *full* history (older
events can be missing depending on export settings and app version), so a
replay is only ever as complete as what happened to survive in that
particular export.

Instead, each **Community tab** has an "Update total members" form — one
number, one date (defaults to today). Every save adds a new dated point to
that community's history rather than overwriting it (saving the same date
again corrects that entry); "Members vs. previous report" then compares the
current total against whichever entry came before it. This applies at the
**community** level only — group-level member counts don't exist anywhere in
the app any more, including on Group Snapshot cards, which now show
messages, active chatters, top voices and the status tag only.

## The routine: manually-dated WhatsApp reports, one consistent date picker

Every import — WhatsApp, Short.io, and GA4 — uses the same two-date-field
picker (start date, end date; see
[`components/DateRangeFields.tsx`](components/DateRangeFields.tsx)), so the
three sources no longer feel like three different tools.

For **WhatsApp**, both dates matter: you choose the range, and the dashboard
reports on exactly that range, regardless of what weeks the chat export's
own message timestamps happen to fall into. Filing the same range again
replaces it; filing a new range adds it as that group's latest report. For
**Short.io/GA4**, only the start date matters (each export is still one
Monday–Sunday week's snapshot) — the end date field is there for visual
consistency across all three pickers, and the panel states plainly which
week the start date resolves to before you upload.

### Exporting from WhatsApp

1. Open the group in WhatsApp, tap the group name to open **Group info**.
2. Scroll down and tap **Export chat**, then choose **Include media** or
   **Without media** — both work; upload the resulting `.zip` or `.txt`
   directly, no manual unzipping needed.
3. Enter the report's start and end date in the two fields above the file
   picker, then upload.

With media, only the chat `.txt` inside the `.zip` is read (found by name —
WhatsApp always includes "chat" in it — falling back to the largest `.txt`
entry if that fails to match). Every photo, video and voice note in the
archive is left compressed and untouched. A "with media" export is capped at
80MB (a 25MB cap applies to text-only `.txt` uploads).

From messages inside your chosen range only:

- **Messages this period**, **unique active chatters**, **top voices** (by
  message count).
- **Activity level** (Low/Medium/High) — this report's message count vs. the
  group's own previous filed report, not a fixed threshold.
- **Main topics** — the period's most frequent non-filler words, title-cased.
  A local word-frequency heuristic, not LLM-generated (per-group; see below
  for the community-level version, which is LLM-generated).
- **Sentiment** — a positive/neutral/negative split by a small bundled word
  list, plus up to three example messages per bucket.

All of the above is computed locally in
[`lib/imports/whatsapp.ts`](lib/imports/whatsapp.ts) — no network call, no API
key, nothing sent anywhere.

## Members vs. previous report

Every Community tab, and the Overview page (pooled across all three
communities), has a dedicated section comparing the current member total
against whichever manual entry came before it — previous count, now, and the
signed change. Shows an honest "nothing to compare yet" instead of a
misleading zero when there's no earlier entry on file for that community.

## Upload reliability

Large exports and the Groq call together can take longer than a serverless
platform's default function timeout (10s on Vercel Hobby) — previously that
looked like a silent failure needing a retry, with no real indication
anything had gone wrong. Two fixes:

- `app/api/imports/route.ts` and the two `/api/ai/*` routes now declare
  `export const maxDuration = 60` explicitly.
- Reads from Vercel Blob now pass `useCache: false`
  ([`lib/vercel-blob.ts`](lib/vercel-blob.ts)) — Vercel's own docs note that
  a read immediately after a write to the same blob path can return the
  *previous* version for up to 60 seconds through the CDN cache otherwise,
  which is exactly the "uploaded fine, but doesn't show up" symptom this
  app was hitting on every upload → refresh cycle.
- The upload panel now shows a visible, growing "still working" indicator
  (elapsed seconds, a note for anything past 15s) instead of a static
  "loading…", and distinguishes a real timeout (504) or a dropped connection
  from a generic failure in the error message shown.

## The external calls: Groq

Two kinds of Groq call, both against the free-tier chat completions API
([`lib/ai/groq.ts`](lib/ai/groq.ts)) — the one deliberate exception to
"nothing leaves this machine" in this app, made with the user's explicit
sign-off. Set `GROQ_API_KEY` in `.env.local` (get one free at
[console.groq.com](https://console.groq.com)) — without it, everything else
still works, the AI-written fields are just omitted.

**Per group, automatic on upload** — that report's real chat text is sent to
generate:
- **Status tag** — e.g. "Most Active", "On-topic", "Silent", "Low".
- **Top voices summary** — one sentence characterising who's driving the
  conversation.
- **Narrative** — a short paragraph on what people are actually talking
  about, shown on that group's own page.

**Per community and for the Overview, manual** — triggered by a
"Regenerate" button, not automatically, since both depend on several
groups' reports having settled first (and firing on every page load would
be an unbounded number of calls):
- **Community tab** — one "Main topics discussed" pill list and one
  narrative paragraph, synthesised across that community's groups' already-
  generated summaries (not raw chat text — no additional message content is
  sent for this call).
- **Overview** — "Headline Takeaways" synthesised the same way across every
  community. Falls back to a local, non-LLM heuristic (activity turnarounds,
  the busiest community, a newly-small community) until you generate a
  richer version — see `headlineTakeaways()` in
  [`lib/dashboard.ts`](lib/dashboard.ts).

A failed or rate-limited call is swallowed in every case — the numeric
figures are already saved and usable either way. Chat text and message
senders are never persisted; they exist only for the duration of the request
that generated a summary.

## Structure — all in one file

Communities and their groups live in [`lib/groups.ts`](lib/groups.ts).
Nothing else defines them. Adding a group or a whole community is an edit
there and nowhere else — group slugs are globally unique across communities,
so a stored WhatsApp import needs no community column of its own.

## Where data is stored

Four small JSON documents, holding a handful of numbers per upload or entry
— never the source files, and never their raw rows:

- `imports.json` — one record per uploaded file: source, community/group,
  the manually-entered date range (WhatsApp) or week (Short.io/GA4),
  filename, the extracted figures, and the per-group AI summary.
- `community-members.json` — the manually-entered "Total members" history,
  one append-only log per community.
- `community-summaries.json` / `overview-takeaways.json` — the
  manually-generated community and Overview AI summaries, regenerated on
  demand.

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
  Storage → Create Database → Blob) and connect it to the project —
  `BLOB_READ_WRITE_TOKEN` is then injected automatically, no manual key
  needed. Only small JSON documents are ever stored — no raw uploaded files.
  Access defaults to `private` (see `.env.local`) since these documents
  contain real names and quoted message snippets.

All four are small enough to read and correct by hand.

## What's manual vs. computed

You type: a report's start/end date per WhatsApp upload, each community's
total member count (with its date), and the Groq "Regenerate" clicks — all
deliberately manual. Everything else: Short.io and GA4 figures are read
straight from the uploaded files; every WhatsApp-derived figure (messages,
active chatters, top voices, activity level, topics, sentiment) is computed
from the chat export for your chosen range; the AI status tag/summary/
narrative come from Groq. If you're looking for polls, DMs, leads, a
free-text notes form, or parsed member counts — those were part of an
earlier version of this app and have been removed.

## Layout

```
app/
  page.tsx                        Overview
  c/[community]/page.tsx          Community tab (headline stats, member entry, snapshot cards)
  c/[community]/group/[slug]/     Group detail (sentiment, topics, WhatsApp upload)
  merged/page.tsx                 Landing page & WADL (GA4 + Short.io — untouched)
  group/[slug]/                   Legacy redirect to the community-scoped group URL
  api/imports/                    POST an export (Short.io/GA4/WhatsApp), DELETE by id
  api/imports/reset/              POST — wipe every uploaded import
  api/community-members/          POST { community, total, enteredAt? } — record a manual entry
  api/ai/community-summary/       POST { community } — regenerate a community's AI synthesis
  api/ai/overview-takeaways/      POST — regenerate the Overview's AI takeaways
  globals.css                     The whole design system (red/black/paper)
lib/
  groups.ts                 Communities, groups — the single source of structure
  types.ts                  Shared types
  weeks.ts                  Monday-anchored week maths (Short.io/GA4 only), all in UTC
  period.ts                 Manual date-range maths for WhatsApp reports
  zip.ts                     Minimal ZIP reader shared by the .xlsx and "with media" readers
  vercel-blob.ts             Vercel Blob read/write for the JSON stores (Vercel deploys only)
  community-members.ts       Manual per-community member-total history
  metrics.ts                Every derived metric and formatter
  dashboard.ts               The one loader every page uses, plus roll-ups and takeaways
  ai/groq.ts                  The two Groq call shapes: per-group and cross-group synthesis
  ai/store.ts                 Persistence for the manually-triggered community/overview summaries
  imports/
    shortio.ts, ga4.ts      Short.io/GA4 file readers (untouched)
    whatsapp.ts             The WhatsApp chat parser — message-level figures only, no replay
    store.ts                Persistence for every uploaded file's figures
components/                 Charts, stat tiles, snapshot cards, DateRangeFields, the WhatsApp
                             upload panel, MemberComparison, CommunityMemberEntryForm,
                             CommunityTopicsPanel, RegenerateButton
```

Short.io/GA4 weeks are Monday→Sunday, identified by the Monday as
`YYYY-MM-DD`, computed in UTC. WhatsApp report periods are whatever
start/end date you enter — no alignment requirement — also computed in UTC
so a viewer's timezone can never shift a message into the wrong report.
