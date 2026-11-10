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

Use **My calendars → +** to create named calendars with their own colors. The
adjacent menu edits a calendar's name and color. Sidebar checkboxes show or hide
each calendar, and the event/task editor can move items between calendars.
Existing records belong to **My calendar**. Calendars and membership are retained
in folder replicas; visibility is remembered on this device.

Import lets you choose a destination or create a calendar, select an `.ics` file,
then explicitly import it. Creating the calendar and importing its items is atomic.
Duplicate UIDs are skipped within the destination (including deleted records).
Export can include one calendar or all calendars. When calendars contain copies
of the same UID, export them separately to preserve valid iCalendar identities.

Import/export uses **RFC 5545 iCalendar 2.0**, parsed by `ical.js`. VEVENT and VTODO
are supported. Stable UIDs prevent duplicates, including after local deletion.
Imports validate before saving, skip existing UIDs (they do not refresh them), and
limit files to 5 MB / 2,000 items. Existing native tasks need no data migration.
Export includes all undeleted items in the chosen calendar(s), irrespective of view filters.

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

## Google Calendar sync

Open **Calendar options → Google Calendar sync → Google Calendar setup** for
the Cloud Console steps, links, and required permissions.

Enable the Calendar API in a Google Cloud project and create a **Desktop app**
OAuth client. Download its JSON file. If the OAuth consent screen is in testing,
add your Google account as a test user. Google expires Calendar authorization
after seven days in Testing. [Google Cloud setup](https://developers.google.com/workspace/calendar/api/quickstart/python) · [Google OAuth audiences](https://support.google.com/cloud/answer/15549945)

To open Google sign-in directly, save the downloaded file as
`google-calendar.oauth.json` in Sisyphus app data (`%APPDATA%\Sisyphus` on
Windows, or the directory selected by `SISYPHUS_USER_DATA`). You can also select
the file once from **Calendar options → Google Calendar sync → Connect Google account**.
Sisyphus remembers the client in encrypted storage for future sign-ins.

Choose **Connect Google account** and approve access in your browser. Select a
Google calendar you can edit, then choose **Link calendar**. Sisyphus creates a
separate local calendar and syncs immediately. Automatic sync runs every five
minutes while Sisyphus is open. You can turn it off in the sync dialog or choose
**Sync now** at any time. Connections created before automatic sync was added
keep manual sync until you enable it.

Sync exchanges additions, edits, and deletions. Move an event
out of the linked calendar to remove its Google copy on the next sync. Single
events without guests are supported. Recurring events, invitations, special
event types, imported schedules, and tasks stay in their source calendar. The
sync result reports skipped entries.

When an event changed on both sides, the linked calendar uses Google's version
and Sisyphus keeps a copy of the local edit in **My calendar**. A local deletion
in conflict with a Google edit leaves the Google event in place. Reconnect the
same account if authorization expires. Automatic sync pauses until you reconnect.
Disconnecting removes the account authorization from Sisyphus and keeps the
OAuth client, local calendar, and events.

## Provider integration boundary

The UI uses the injected `Planner` contract for local data. The backend repository owns
local IDs, stable iCalendar UIDs, persistence, and tombstones. `CalendarProvider`
in the SDK sketches an adapter contract for future providers. The Google adapter
uses the Calendar API, conditional writes, and a separate mapping of local event
IDs to Google event IDs. Each sync reads the selected calendar in pages.
OAuth credentials are encrypted with Electron safe storage.

The current manual folder adapter merges a portable **JSON replica**, retaining
tombstones and local metadata. ICS is an exchange format and intentionally does
not masquerade as the replication database. Existing sync folders keep working.

For Google Tasks, Microsoft Graph, CalDAV, or another service, add a
backend adapter. Keep account-specific fields and credentials in the backend.
Persist remote bindings in a
separate mapping keyed by provider/account/calendar/local ID. Store credentials
in the operating system's credential store. A sync coordinator still needs an
outbox, conditional writes, incremental cursors, conflict reporting, token refresh,
and retry/backoff. Account removal must detach its bindings without deleting
local records. Capabilities must distinguish event, task, and recurrence support
and report any entries left in the source calendar.
Register adapters through Cordis and dispose subscriptions on plugin unload.

Tests: backend `calendar.test.js` covers preservation, atomic import, duplicates,
deletions, Unicode folding, dates, and time zones. Frontend `calendar-model.test.ts`
covers grid boundaries, recurrence exceptions, and missing-zone behavior.
`calendar-search.test.ts` covers search scope, normalization, and title ranking.

References: [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545),
[ICAL.js](https://github.com/kewisch/ical.js).

## Optional Actions integration

Calendar and its Actions presentations are independent frontend entries in this
package. The backend adapter also lives here and injects `planner.v1` and
`actions.v1`. It calls `validateEvent(event)` for side-effect-free validation and
`createEvent(event)` to save. Both frontends share the same scheduling controls.
Calendar stays usable when Actions is disabled; no folder split is required.
