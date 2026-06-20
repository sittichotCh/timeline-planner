# Sync Events from Google Calendar — Design

- **Date:** 2026-06-20
- **Status:** Approved (design)
- **Branch:** `feat/google-calendar-sync`

## 1. Goal

A new **Settings** page lets a user register one or more **public Google
Calendar** links. Syncing fetches each calendar's public iCal feed, reads each
event's member email (from the event title), matches it to a member by email,
and writes a managed `CalendarEvent` onto the timeline. Sync runs from a
**manual button** and **automatically when the app loads**. Re-syncing keeps the
timeline in step with the calendar — new events appear, changed events update,
removed events disappear.

## 2. Decisions (locked during brainstorming)

1. **Shared team calendar(s), matched by email.** One feed holds many members'
   events; each event is assigned to the member whose email appears in it.
2. **Email comes from the event title (`SUMMARY`).** The real feed has no
   `ATTENDEE`/`ORGANIZER` fields — the member email is the title (sometimes with
   surrounding text). Extract an email from `SUMMARY`; no email → skip the event.
   Email not a known member → skip.
3. **Multiple calendar sources (a list).** The Settings page manages a list;
   each source = `name` + `url` + `event_type`. "Sync all" processes every
   source.
4. **Event type is configurable per source** (`leave` / `oncall` / `holiday` /
   `other`). **Scope is always `personal`** (each synced event belongs to the one
   matched member). **Title = the source's `name`** (the email-only `SUMMARY` is a
   poor label).
5. **Sync trigger = manual button + auto-on-load.** No background scheduler.
6. **Public iCal only, read-only.** Like the Jira client, the calendar is never
   written to. No OAuth.

## 3. Data findings (from the real example feed)

Fetched `…/calendar/ical/<id>/public/basic.ics` for the example `cid`
(`HTTP 200`, "POS On-call Calendar", `X-WR-TIMEZONE: Asia/Bangkok`):

- **1249 `VEVENT`s, zero `RRULE`** → no recurrence expansion needed.
- **No `TZID`/`VTIMEZONE`** → timed events are UTC (`…Z`); 76 are all-day
  (`DTSTART;VALUE=DATE`).
- `SUMMARY` is a bare email (sometimes a leading space), with some non-email
  junk (`New Event`) → extraction must trim and skip non-matches.
- Stable `UID` per event → reliable upsert/prune key.

Consequence: a **small custom iCal parser** is sufficient — **no new
dependency**. Events carrying an `RRULE` are skipped and **counted** (honest
boundary; none exist in this feed).

## 4. URL normalization

Accept any of: the share URL (`…/calendar/u/0?cid=<base64>`), a raw `.ics` URL,
or a bare calendar ID. Resolution:

- `cid` present → base64-decode (tolerate missing padding and URL-safe
  alphabet) → calendar ID.
- Build feed URL: `https://calendar.google.com/calendar/ical/<urlencoded-id>/public/basic.ics`.
- A URL already ending in `.ics` is used as-is.

The user's original input is stored on the source; the feed URL is resolved at
sync time.

## 5. Data model

- **New `model.CalendarSource` (Go)** — `internal/model/calendar_source.go`:
  `id`, `name`, `url`, `event_type`, `last_synced_at`.
- **New CSV `calendar_sources.csv`** — header
  `id, name, url, event_type, last_synced_at`.
- **Extend `model.Event`** with three fields:
  - `source` — `"manual"` (default) | `"google"`
  - `source_id` — the `CalendarSource.id` that produced it (empty for manual)
  - `external_uid` — the iCal `UID` (empty for manual)
- **`events.csv`** gains three trailing columns. New header:
  `id, member_emails, scope, type, title, start_date, end_date, counts_as_working_day, source, source_id, external_uid`.
  Migration is **lazy** (consistent with `counts_as_working_day`): rows missing
  the columns parse as `source="manual"`, the rest empty; the new columns are
  written on the next save.
- **`CalendarEvent` (TS):** add optional `source?`, `source_id?`,
  `external_uid?`. New `CalendarSource` and `CalendarSyncResult` types.

## 6. Backend — store

- **`store/calendar_sources.go`** — `GetCalendarSources / CreateCalendarSource /
  UpdateCalendarSource / DeleteCalendarSource`, following the existing
  `readCSV/writeCSV` + `genID()` pattern under the shared `sync.RWMutex`.
- **`store/events.go`** — extend `eventsHeader`; `parseEventRow` reads the three
  new indices when present (else defaults); `eventToRow` appends them. Add a
  helper used by sync:
  - `ReplaceSyncedEvents(sourceID string, events []model.Event) (added, updated, removed int)`
    — under the write lock: index existing events by `external_uid` **for that
    `source_id`**; create new, replace changed, delete those whose `external_uid`
    is absent from the incoming set. Manual events and other sources are
    untouched. Returns counts.
  - `DeleteSyncedEventsBySource(sourceID string) int` — used when a source is
    deleted.

## 7. Backend — iCal client & sync (`internal/gcal/`)

- **`client.go`** — resty client; `FetchFeed(feedURL) (string, error)` (read-only
  GET). Config follows the Jira pattern.
- **`ical.go`** — minimal parser:
  - Unfold continuation lines (leading space/tab), split into `VEVENT` blocks.
  - Per event read `UID`, `SUMMARY`, `DTSTART`, `DTEND`, and detect `RRULE`.
  - **Timed (`…Z`)**: parse as UTC, convert to the feed's `X-WR-TIMEZONE`
    (present in this feed = `Asia/Bangkok`; if the header is absent or the zone
    can't be loaded, fall back to UTC), then format `YYYY-MM-DD`. (So a
    `17:00Z–05:00Z` shift lands on the correct local day.)
  - **All-day (`VALUE=DATE`)**: use the date verbatim; iCal `DTEND` is
    **exclusive**, so `end_date = DTEND − 1 day` (single-day events where
    `DTEND` is absent or equals `DTSTART+1` collapse to one day).
  - Skip + count events with `RRULE`.
- **`sync.go`** — `BuildEvents(source, feed, members) (events []model.Event, skipped int)`:
  - For each parsed event: extract email from `SUMMARY` via
    `[\w.+-]+@[\w.-]+\.\w+` (trimmed); no email or unknown member → `skipped++`.
  - Build `model.Event`: `member_emails=[email]`, `scope="personal"`,
    `type=source.event_type`, `title=source.name`,
    `counts_as_working_day` derived from type (`leave`/`holiday` → `false`,
    `oncall`/`other` → `true`), `source="google"`, `source_id=source.id`,
    `external_uid=UID`.

## 8. Backend — handler & routes

- **`handler/calendar_sources.go`** — `type CalendarSources struct { store
  *store.Store; client *gcal.Client }`.
  - `List`, `Create`, `Update`, `Delete` (CRUD; `Delete` also calls
    `DeleteSyncedEventsBySource`).
  - `SyncAll` — for each source: resolve feed URL → `FetchFeed` →
    `BuildEvents` → `ReplaceSyncedEvents`; stamp `last_synced_at`; aggregate
    `{added, updated, removed, skipped}` (per-source + totals). A single source's
    fetch error is captured in that source's result, not fatal to the others.
- **Routes** under `/api/calendar-sources` (registered in `cmd/server/main.go`
  like the other groups):
  - `GET ""` → list
  - `POST ""` → create
  - `PUT "/:id"` → update
  - `DELETE "/:id"` → delete (+ prune its events)
  - `POST "/sync"` → sync all → summary

## 9. Frontend

- **`src/api/calendarSources.ts`** — `fetchCalendarSources`, `createCalendarSource`,
  `updateCalendarSource`, `deleteCalendarSource`, `syncCalendars()` (thin `fetch`
  wrappers, matching `api/jira.ts`).
- **`src/components/SettingsPage.tsx`** — a `PageView` (like `JiraSyncPage`):
  - A table/list of sources; each row edits `name`, `url`, and an event-type
    `Select`; add and delete rows.
  - A **Sync now** button that calls `syncCalendars()` and shows the result
    summary (`N added · N updated · N removed · N skipped`) and per-source
    `last_synced_at`; surfaces per-source fetch errors.
  - On save, re-fetches events so the timeline reflects changes.
- **`src/App.tsx`**:
  - Add `"settings"` to `PageView`; add a nav item (lucide `Settings` icon);
    conditional render of `<SettingsPage … />` in `main`.
  - **Auto-on-load:** on mount, fire `syncCalendars()` **non-blocking** with a
    subtle "syncing…" indicator; on success re-fetch events. Failures are ignored
    silently (the last successful sync's data is already shown).

## 10. Sync semantics & edge cases

- **Idempotent.** Identity is `(source_id, external_uid)`. Re-sync upserts and
  prunes within that source only; manual events and other sources are never
  touched.
- **Unmatched events** (no email / unknown member) and **RRULE events** are
  skipped and counted, never created.
- **Managed events.** Synced events are owned by sync; manual edits to them may
  be overwritten on the next sync. They are distinguishable via `source`.
- **Deleting a source** removes all of its synced events.
- **No sync window** — the entire feed is processed (≈1249 rows is fine for CSV).

## 11. Testing

- **Backend (TDD):**
  - `gcal/ical`: timed UTC→`Asia/Bangkok` date conversion (incl. the cross-midnight
    shift); all-day exclusive-`DTEND` → `end_date`; junk/non-email `SUMMARY`
    skipped; `RRULE` event skipped+counted; line unfolding. Uses a trimmed real
    `.ics` fixture.
  - `gcal` URL normalization: `cid` (with/without padding) → feed URL; raw `.ics`
    passthrough; bare ID.
  - `store`: `CalendarSource` CRUD round-trip; `events.csv` back-compat (old
    8-column rows parse as `source="manual"`); `ReplaceSyncedEvents` diff —
    add/update/remove counts, manual + other-source events untouched.
- **Frontend:** verified in a real browser with Playwright — add a source, Sync
  now, synced on-call events appear on the matched members' rows; editing the
  type re-colors them on next sync; deleting the source removes them; auto-on-load
  refreshes. Plus `npm run build` (tsc) + `npm run lint`. (No frontend unit-test
  runner exists.)

## 12. Anticipated file changes

**Backend**
- `internal/model/calendar_source.go` — new model.
- `internal/model/event.go` — add `source`, `source_id`, `external_uid`.
- `internal/store/calendar_sources.go` — new store + CSV.
- `internal/store/events.go` — header/parse/serialize; `ReplaceSyncedEvents`,
  `DeleteSyncedEventsBySource`.
- `internal/gcal/client.go`, `internal/gcal/ical.go`, `internal/gcal/sync.go` —
  fetch, parse, build.
- `internal/handler/calendar_sources.go` — CRUD + `SyncAll`.
- `cmd/server/main.go` — route group + handler wiring.

**Frontend**
- `src/types/index.ts` — `CalendarSource`, `CalendarSyncResult`; extend
  `CalendarEvent`.
- `src/api/calendarSources.ts` — new API wrappers.
- `src/components/SettingsPage.tsx` — new page.
- `src/App.tsx` — nav item, `PageView`, render, auto-on-load sync.

## 13. Non-goals / out of scope

- Background polling / scheduler (auto-on-load + manual only).
- OAuth / private calendars / Google Calendar API.
- Recurring-event (`RRULE`) expansion — such events are skipped + counted.
- Auto-creating members from unknown emails (unlike Jira import — skip instead).
- Writing back to Google (read-only, always).
- Per-source scope or `counts_as_working_day` overrides (scope is always
  `personal`; the flag is derived from type).
