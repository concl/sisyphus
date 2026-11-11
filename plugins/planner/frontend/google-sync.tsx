import { useEffect, useState } from 'react'
import { readable } from '@sisyphus/sdk'
import { PanelSurface } from './panel-surface'

type SetupPage = 'calendar' | 'branding' | 'audience' | 'scopes' | 'clients'
type Status = {
  connected: boolean
  hasClient: boolean
  calendar: string | null
  automatic: boolean
  syncing: boolean
  lastSync: { at: string; result: SyncResult } | null
  syncError: string
  scopes: string[]
}
type GoogleCalendar = { id: string; name: string }
type SyncResult = {
  pulled: number
  pushed: number
  conflicts: number
  skippedGoogle: number
  skippedLocal: number
  deferred: number
}
export type GoogleSync = {
  status(): Promise<Status>
  subscribe(listener: (status: Status) => void): () => void
  openSetupPage(page: SetupPage): Promise<void>
  connect(): Promise<Status>
  cancelConnect(): Promise<void>
  calendars(): Promise<GoogleCalendar[]>
  link(id: string): Promise<Status>
  sync(): Promise<SyncResult>
  setAutomatic(enabled: boolean): Promise<Status>
  disconnect(): Promise<Status>
}

const initialStatus: Status = {
  connected: false,
  hasClient: false,
  calendar: null,
  automatic: false,
  syncing: false,
  lastSync: null,
  syncError: '',
  scopes: [],
}

function SetupGuide({
  scopes,
  openPage,
}: {
  scopes: string[]
  openPage: (page: SetupPage) => void
}) {
  const link = (page: SetupPage, label: string) => (
    <button type="button" className="cal-setup-link" onClick={() => openPage(page)}>
      {label}
    </button>
  )
  return (
    <details className="cal-setup-guide">
      <summary>Google Calendar setup</summary>
      <ol>
        <li>
          Create or select a Google Cloud project. In that project, enable the{' '}
          {link('calendar', 'Google Calendar API')}.
        </li>
        <li>
          In {link('branding', 'Branding')}, choose <strong>Get started</strong> if prompted. Enter
          an app name and your email addresses. For a personal Google account, choose{' '}
          <strong>External</strong> as the audience.
        </li>
        <li>
          If your project is in <strong>Testing</strong>, open {link('audience', 'Audience')} and
          add the Google account you want to connect under <strong>Test users</strong>.
        </li>
        <li>
          For an external audience, open {link('scopes', 'Data Access')}, choose{' '}
          <strong>Add or Remove Scopes</strong>, and save these Calendar scopes.
          {scopes.map((scope) => (
            <code key={scope}>{scope}</code>
          ))}
        </li>
        <li>
          In {link('clients', 'Clients')}, choose <strong>Create client</strong> and select{' '}
          <strong>Desktop app</strong>. Name the client and download its JSON file.
        </li>
        <li>
          Back in Sisyphus, choose <strong>Connect Google account</strong>, select the downloaded
          JSON file, and allow both Calendar permissions in your browser. Choose a calendar you can
          edit, then select <strong>Link calendar</strong>.
        </li>
      </ol>
      <p>
        In Testing, Google access expires after seven days. Use <strong>Reconnect account</strong>{' '}
        to restore it.
      </p>
    </details>
  )
}

function syncSummary({
  pulled,
  pushed,
  conflicts,
  skippedGoogle,
  skippedLocal,
  deferred,
}: SyncResult) {
  const messages = [`Received ${pulled} and sent ${pushed} event changes.`]
  if (conflicts)
    messages.push(
      `Resolved ${conflicts} conflicts using Google's versions. Conflicting Sisyphus edits were copied to your default calendar.`,
    )
  if (skippedGoogle || skippedLocal)
    messages.push(
      `Skipped ${skippedGoogle} unsupported Google entries and ${skippedLocal} unsupported Sisyphus entries.`,
    )
  if (deferred) messages.push(`Deferred ${deferred} changes. Choose Sync now to retry.`)
  return messages.join(' ')
}

export function GoogleSyncDialog({ api, close }: { api: GoogleSync; close: () => void }) {
  const [status, setStatus] = useState(initialStatus)
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([])
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  useEffect(() => {
    let active = true
    let updated = false
    const unsubscribe = api.subscribe((status) => {
      updated = true
      setStatus(status)
    })
    void api
      .status()
      .then(async (status) => {
        if (!active) return
        if (!updated) setStatus(status)
        if (status.connected && !status.calendar) {
          const calendars = await api.calendars()
          if (active) setCalendars(calendars)
        }
      })
      .catch((error) => {
        if (active) setError(readable(error))
      })
      .finally(() => {
        if (active) setBusy(false)
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [api])

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (error) {
      setError(readable(error))
    } finally {
      setBusy(false)
    }
  }
  const connect = () =>
    run(async () => {
      setConnecting(true)
      const status = await api.connect().finally(() => setConnecting(false))
      setStatus(status)
      if (status.connected && !status.calendar) {
        setSelected('')
        setCalendars([])
        setCalendars(await api.calendars())
      }
    })
  const disabled = busy || status.syncing
  const message = error || status.syncError

  return (
    <PanelSurface title="Google Calendar sync" close={close} busy={busy} compact dismissOnBackdrop>
      <div className="cal-transfer-body">
        <p>
          Sync single events without guests. Recurring events, invitations, imported schedules, and
          tasks stay in their source calendar.
        </p>
        {!status.connected ? (
          <>
            <p>
              {status.hasClient
                ? 'Sign in in your browser and allow Calendar access.'
                : 'On first use, choose the OAuth client JSON for your Google Cloud Desktop app.'}
            </p>
            <button className="cal-primary" disabled={busy} onClick={() => void connect()}>
              Connect Google account
            </button>
          </>
        ) : status.calendar ? (
          <>
            <div className="cal-file-preview">
              <div>
                <strong>{status.calendar}</strong>
                <span>Edits, deletions, and moves out of the linked calendar sync to Google.</span>
              </div>
            </div>
            <label>
              <input
                type="checkbox"
                checked={status.automatic}
                disabled={disabled}
                onChange={(event) => {
                  const enabled = event.target.checked
                  void run(async () => setStatus(await api.setAutomatic(enabled)))
                }}
              />{' '}
              Sync after edits and every five minutes while Sisyphus is open
            </label>
            <button
              className="cal-primary"
              disabled={disabled}
              onClick={() =>
                void run(async () => {
                  await api.sync()
                })
              }
            >
              {status.syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </>
        ) : (
          <>
            <label className="cal-transfer-field">
              Google calendar
              <select
                value={selected}
                disabled={busy}
                onChange={(event) => setSelected(event.target.value)}
              >
                <option value="">Choose a calendar</option>
                {calendars.map((calendar) => (
                  <option value={calendar.id} key={calendar.id}>
                    {calendar.name}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Sisyphus creates a linked calendar and syncs it now, after edits, and every five
              minutes while the app is open.
            </p>
            <button
              className="cal-primary"
              disabled={busy || !selected}
              onClick={() => void run(async () => setStatus(await api.link(selected)))}
            >
              Link calendar
            </button>
          </>
        )}
        {status.connected &&
          (confirmDisconnect ? (
            <>
              <p>
                Disconnect this account and keep the linked calendar and its events in Sisyphus?
              </p>
              <div className="cal-button-row">
                <button disabled={disabled} onClick={() => setConfirmDisconnect(false)}>
                  Cancel
                </button>
                <button
                  disabled={disabled}
                  onClick={() =>
                    void run(async () => {
                      setStatus(await api.disconnect())
                      setConfirmDisconnect(false)
                      setCalendars([])
                      setSelected('')
                    })
                  }
                >
                  Disconnect
                </button>
              </div>
            </>
          ) : (
            <div className="cal-button-row">
              <button disabled={disabled} onClick={() => void connect()}>
                Reconnect account
              </button>
              <button disabled={disabled} onClick={() => setConfirmDisconnect(true)}>
                Disconnect
              </button>
            </div>
          ))}
        <SetupGuide
          scopes={status.scopes ?? []}
          openPage={(page) => {
            setError('')
            void api.openSetupPage(page).catch((error) => setError(readable(error)))
          }}
        />
        {busy && <p role="status">Working with Google Calendar…</p>}
        {connecting && (
          <button
            onClick={() => void api.cancelConnect().catch((error) => setError(readable(error)))}
          >
            Cancel Google sign-in
          </button>
        )}
        {status.lastSync && (
          <p role="status" className="cal-feedback">
            Last synced {new Date(status.lastSync.at).toLocaleString()}.{' '}
            {syncSummary(status.lastSync.result)}
          </p>
        )}
        {message && (
          <p role="alert" className="cal-feedback cal-error">
            {message}
          </p>
        )}
      </div>
    </PanelSurface>
  )
}
