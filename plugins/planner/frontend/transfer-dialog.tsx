import { useRef, useState } from 'react'
import type { Planner } from '@sisyphus/sdk'
import { PanelSurface } from './panel-surface'
import { Icon } from './icons'
export type TransferMode = 'import' | 'export' | 'sync'

export function TransferDialog({
  planner,
  folder,
  mode,
  close,
}: {
  planner: Planner
  folder: string | null
  mode: TransferMode
  close: () => void
}) {
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [chosenName, setChosenName] = useState('')
  const act = async (work: () => Promise<unknown>, message?: string) => {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await work()
      if (message) setNotice(message)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const title =
    mode === 'import' ? 'Import calendar' : mode === 'export' ? 'Export calendar' : 'Folder sync'
  return (
    <PanelSurface title={title} close={close} busy={busy} compact dismissOnBackdrop>
      <div className="cal-transfer-body">
        {mode === 'import' && (
          <>
            <p>Add events and tasks from an iCalendar (.ics) file.</p>
            <input
              ref={file}
              type="file"
              accept=".ics,text/calendar"
              hidden
              onChange={(event) => {
                const chosen = event.target.files?.[0]
                event.target.value = ''
                if (!chosen) return
                setChosenName(chosen.name)
                void act(async () => {
                  if (chosen.size > 5 * 1024 * 1024)
                    throw new Error('Choose an .ics file smaller than 5 MB.')
                  const result = await planner.importICS(await chosen.text())
                  setNotice(
                    `${result.added} ${result.added === 1 ? 'item' : 'items'} imported${result.skipped ? `; ${result.skipped} already in your calendar` : ''}.`,
                  )
                })
              }}
            />
            <button
              className="cal-file-picker"
              disabled={busy}
              onClick={() => file.current?.click()}
            >
              <Icon name="import" size={24} />
              <strong>{busy ? 'Importing…' : 'Choose .ics file'}</strong>
              <span>{chosenName || 'Up to 5 MB'}</span>
            </button>
            <p className="cal-footnote">
              Existing items are kept. Re-importing a file won’t create duplicates.
            </p>
          </>
        )}
        {mode === 'export' && (
          <>
            <p>Download all events and tasks as an .ics file you can use in other calendar apps.</p>
            <div className="cal-file-preview">
              <Icon name="calendar" size={24} />
              <div>
                <strong>sisyphus-calendar.ics</strong>
                <span>All dates, including completed tasks</span>
              </div>
            </div>
            <button
              className="cal-primary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const text = await planner.exportICS()
                  const url = URL.createObjectURL(
                    new Blob([text], { type: 'text/calendar;charset=utf-8' }),
                  )
                  const link = document.createElement('a')
                  link.href = url
                  link.download = 'sisyphus-calendar.ics'
                  link.click()
                  setTimeout(() => URL.revokeObjectURL(url), 1000)
                }, 'Your calendar was exported.')
              }
            >
              <Icon name="export" />
              {busy ? 'Exporting…' : 'Download .ics'}
            </button>
          </>
        )}
        {mode === 'sync' && (
          <>
            <p>Sync manually through a folder managed by your cloud provider.</p>
            <div className="cal-file-preview">
              <Icon name="folder" size={22} />
              <div>
                <strong>{folder || 'No folder selected'}</strong>
                <span>
                  {folder ? 'Ready to sync' : 'Choose a OneDrive, Dropbox, or other synced folder'}
                </span>
              </div>
            </div>
            <div className="cal-button-row">
              <button disabled={busy} onClick={() => void act(() => planner.chooseFolder())}>
                {folder ? 'Change folder' : 'Choose folder'}
              </button>
              <button
                className="cal-primary"
                disabled={busy || !folder}
                onClick={() => void act(() => planner.sync(), 'Folder sync complete.')}
              >
                <Icon name="sync" />
                {busy ? 'Syncing…' : 'Sync now'}
              </button>
            </div>
          </>
        )}
        {notice && (
          <p role="status" className="cal-feedback">
            <Icon name="check" />
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="cal-feedback cal-error">
            {error}
          </p>
        )}
      </div>
    </PanelSurface>
  )
}
