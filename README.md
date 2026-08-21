# amber Communities · Weekly Engagement Report

A weekly report across amber's WhatsApp communities, built from uploaded
exports plus one thing you type by hand per upload: the report's date range.

| Tab | What it shows |
|---|---|
| **Overview** | Total members across every community, per-community member/message counts, two bar charts, a members-vs-previous-report comparison, and headline takeaways |
| **Community #1 / #2 / #3** | Headline stats, a messages-by-group bar chart, a members-vs-previous-report comparison, a snapshot card per group (status tag, messages, active chatters, top voices), and one community-wide "Main topics discussed" + narrative synthesis |
| **Landing page & WADL** | GA4 landing-page traffic and Community #2's Short.io link data — untouched, still on the original weekly system |

Each group's own page (one click from its snapshot card) has the full
sentiment breakdown, a membership trend across every filed report, and the
WhatsApp upload control.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
npm run build && npm start   # production
npm run typecheck            # tsc --noEmit
```

Every card reads `—`/`0` until a real WhatsApp report is filed for that
group — there is no demo/fabricated data anywhere in this app.

## The routine: manually-dated reports, not auto-detected weeks

Each group's own page has an **Import WhatsApp chat** panel with two date
fields — a report start date and end date — plus a file picker. You choose
the range; the dashboard reports on exactly that range, regardless of what
weeks the chat export's own message timestamps happen to fall into. Filing
the same range again replaces it; filing a new range adds it as that group's
latest report, and the group's report history keeps every range you've ever
filed (used for the membership trend and the previous-report comparison).

Short.io and GA4 still upload from the Landing page & WADL page on the
original Monday-anchored week system — those two integrations weren't
touched by this change.

### Exporting from WhatsApp

1. Open the group in WhatsApp, tap the group name to open **Group info**.
2. Scroll down and tap **Export chat**, then choose **Include media** or
   **Without media** — both work; upload the resulting `.zip` or `.txt`
   directly, no manual unzipping needed.
3. Upload the group's **whole chat history**, every time — not a slice
   matching your chosen range. See why below.
4. Enter the report's start and end date in the two fields above the file
   picker, then upload.

With media, only the chat `.txt` inside the `.zip` is read (found by name —
WhatsApp always includes "chat" in it — falling back to the largest `.txt`
entry if that fails to match). Every photo, video and voice note in the
archive is left compressed and untouched; none of it is ever decompressed or
sent anywhere. A "with media" export is capped at 80MB (a 25MB cap applies to
text-only `.txt` uploads).

A chat export has no "member count" anywhere in it — only join/add/leave/
remove system messages — so member count for any given report is
**replayed**: every join/add is `+1`, every leave/remove is `-1`, in
timestamp order, from the start of the file through your chosen end date.
That's why the full history is needed every time, even though only messages
inside your date range count toward the rest of the report.

From messages inside your chosen range only (not the whole export):

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

Every group page and every Community tab has a dedicated section comparing
the current report's member count against whatever report was filed
immediately before it (by date, not by upload order) — previous count, now,
and the signed change. The Overview page shows the same comparison pooled
across every community. Shows an honest "nothing to compare yet" instead of
a misleading zero when there's no earlier report on file.

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

Three small JSON documents, holding a handful of numbers per upload — never
the source files, and never their raw rows:

- `imports.json` — one record per uploaded file: source, community/group,
  the manually-entered date range (WhatsApp) or week (Short.io/GA4),
  filename, the extracted figures, and the per-group AI summary.
- `community-summaries.json` / `overview-takeaways.json` — the
  manually-generated community and Overview AI summaries, regenerated on
  demand.

Nothing you upload — including the chat transcript itself — is ever kept as
a file; each is parsed in-process and discarded.

**Two backends** ([`lib/supabase-storage.ts`](lib/supabase-storage.ts)),
chosen automatically by whether `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
are set:

- **Local disk** (`data/*.json`, gitignored) — the zero-config default for
  `npm run dev`.
- **Supabase Storage** (bucket `whatsapp-imports` by default — see
  `.env.local`) — **required for any deploy target with a read-only
  filesystem, including Vercel**, since serverless functions there can't
  write to `data/` (only to `/tmp`, which is ephemeral and not shared across
  invocations). The app creates the bucket itself on first write if it's
  missing. Despite the bucket's name, only small JSON documents are ever
  stored in it — no raw uploaded files.

All three are small enough to read and correct by hand.

## What's manual vs. computed

The only thing you type is a report's start/end date per upload (and the
Groq "Regenerate" clicks, which are also manual by design). Everything else:
Short.io and GA4 figures are read straight from the uploaded files; every
WhatsApp-derived figure (members, growth, messages, active chatters, top
voices, activity level, topics, sentiment) is computed from the chat export
for your chosen range; the AI status tag/summary/narrative come from Groq.
If you're looking for polls, DMs, leads, or a free-text notes form — those
were part of an earlier version of this app and have been removed.

## Layout

```
app/
  page.tsx                        Overview
  c/[community]/page.tsx          Community tab (headline stats + snapshot cards)
  c/[community]/group/[slug]/     Group detail (sentiment, trend, WhatsApp upload)
  merged/page.tsx                 Landing page & WADL (GA4 + Short.io — untouched)
  group/[slug]/                   Legacy redirect to the community-scoped group URL
  api/imports/                    POST an export (Short.io/GA4/WhatsApp), DELETE by id
  api/imports/reset/              POST — wipe every uploaded import
  api/ai/community-summary/       POST { community } — regenerate a community's AI synthesis
  api/ai/overview-takeaways/      POST — regenerate the Overview's AI takeaways
  globals.css                     The whole design system (red/black/paper)
lib/
  groups.ts                 Communities, groups — the single source of structure
  types.ts                  Shared types
  weeks.ts                  Monday-anchored week maths (Short.io/GA4 only), all in UTC
  period.ts                 Manual date-range maths for WhatsApp reports
  zip.ts                     Minimal ZIP reader shared by the .xlsx and "with media" readers
  metrics.ts                Every derived metric and formatter
  dashboard.ts               The one loader every page uses, plus roll-ups and takeaways
  ai/groq.ts                  The two Groq call shapes: per-group and cross-group synthesis
  ai/store.ts                 Persistence for the manually-triggered community/overview summaries
  imports/
    shortio.ts, ga4.ts      Short.io/GA4 file readers (untouched)
    whatsapp.ts             The WhatsApp chat parser — replay, range filtering, topics, sentiment
    store.ts                Persistence for every uploaded file's figures
components/                 Charts, stat tiles, snapshot cards, the WhatsApp upload panel,
                             MemberComparison, CommunityTopicsPanel, RegenerateButton
```

Short.io/GA4 weeks are Monday→Sunday, identified by the Monday as
`YYYY-MM-DD`, computed in UTC. WhatsApp report periods are whatever
start/end date you enter — no alignment requirement — also computed in UTC
so a viewer's timezone can never shift a message into the wrong report.
