# Calendar plugin

One Google Calendar-inspired workspace for events and tasks: month, agenda, task
lists, completion, stars, search, timed and multi-day events. Light/dark themes
follow the host. The former Calendar and To-dos packages are retired; the stable
`feature.planner`, `planner.v1`, and `calendar` panel IDs retain existing data and
saved Calendar layouts. Saved To-dos/Planner panels migrate to Calendar.

## Interaction and popup scope

Search is submitted with Enter or the search button and opens a dedicated results
screen across all dates and lists. Results are independent of the current month
and visibility filters; recurring items appear once per stored record. Open a
result to edit, or use its calendar action to jump to its date. Escape or Back to
calendar leaves search. The sidebar toggle remembers its state, with a contained
drawer at narrow panel widths. Clicking a date opens that day's schedule.

Routine overlays belong to the panel that owns the action. Calendar uses local
side sheets for schedules and editing, and compact popovers for import, export,
and folder sync. Only the underlying Calendar frame becomes inert. Other
workspace panels remain usable; there is no body portal, native modal dialog,
global focus trap, or workspace blur. Surfaces have names, initial focus, Escape
dismissal, focus restoration, and inline confirmation for unsaved edits. Reserve
app-wide modal treatment for actions that genuinely require an app-wide decision.

## Portable calendars

Import/export uses **RFC 5545 iCalendar 2.0**, parsed by `ical.js`. VEVENT and VTODO
are supported. Stable UIDs prevent duplicates, including after local deletion.
Imports validate before saving, skip existing UIDs (they do not refresh them), and
limit files to 5 MB / 2,000 items. Existing native tasks need no data migration.
Export includes all undeleted items, irrespective of view filters.

Native timed events store UTC instants. All-day dates remain date-only with an
exclusive end. The editor accepts an inclusive final date and converts it at the
boundary. Imported components retain VTIMEZONE, recurrence/exception rules,
VALARM, attendees, and extension properties. Alarms are preserved, not executed;
attendees are preserved, not invited. Repeating events expand in the visible
range with a bounded iterator. Unresolvable zones and expansion limits surface
notices, not silently shifted times. Repeating tasks show their original due
date and a notice. Imported schedules are read-only; text and task completion
can be edited without rewriting their schedule. Export remains a portable file,
not an invitation or a live subscription. Google Calendar's support for importing
tasks varies; preserving VTODO does not imply that a particular provider accepts it.

## Provider integration boundary

The UI talks only to the injected `Planner` contract. The backend repository owns
local IDs, stable iCalendar UIDs, persistence, and tombstones. `CalendarProvider`
in the SDK sketches a separate backend adapter contract with capabilities,
account/calendar-scoped remote IDs, cursors, ETags, and idempotency keys. It is a
contract for future implementation, not a working Google connection.

The current manual folder adapter merges a portable **JSON replica**, retaining
tombstones and local metadata. ICS is an exchange format and intentionally does
not masquerade as the replication database. Existing sync folders keep working.

For Google Calendar/Tasks, Microsoft Graph, CalDAV, or another service, add a
backend plugin that implements the adapter; don't put account-specific fields or
credentials in the UI or shared calendar records. Persist remote bindings in a
separate mapping keyed by provider/account/calendar/local ID. Store credentials
in the operating system's credential store. A sync coordinator still needs an
outbox, conditional writes, incremental cursors, conflict reporting, token refresh,
and retry/backoff. Account removal must detach its bindings without deleting
local records. Capabilities must distinguish event/task/recurrence support;
unsupported data must stay local and be reported, never silently discarded.
Register adapters through Cordis and dispose subscriptions on plugin unload.

Tests: backend `calendar.test.js` covers preservation, atomic import, duplicates,
deletions, Unicode folding, dates, and time zones. Frontend `calendar-model.test.ts`
covers grid boundaries, recurrence exceptions, and missing-zone behavior.
`calendar-search.test.ts` covers search scope, normalization, and title ranking.

References: [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545),
[ICAL.js](https://github.com/kewisch/ical.js).
