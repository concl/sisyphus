import { useState } from 'react'
import type { Planner, PlannerCalendar } from '@sisyphus/sdk'
import { PanelSurface } from './panel-surface'

export function CalendarFields({
  name,
  color,
  setName,
  setColor,
}: {
  name: string
  color: string
  setName: (value: string) => void
  setColor: (value: string) => void
}) {
  return (
    <div className="cal-calendar-fields">
      <label>
        Calendar name
        <input
          required
          maxLength={100}
          value={name}
          placeholder="Work, Personal, Family…"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Color
        <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
      </label>
    </div>
  )
}

export function CalendarEditor({
  calendar,
  planner,
  close,
}: {
  calendar?: PlannerCalendar
  planner: Planner
  close: () => void
}) {
  const [name, setName] = useState(calendar?.name || '')
  const [color, setColor] = useState(calendar?.color || '#4285f4')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <PanelSurface
      title={calendar ? 'Edit calendar' : 'New calendar'}
      close={close}
      busy={busy}
      compact
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          setBusy(true)
          setError('')
          try {
            await planner.saveCalendar({ id: calendar?.id, name, color })
            close()
          } catch (error) {
            setError(error instanceof Error ? error.message : String(error))
            setBusy(false)
          }
        }}
      >
        <fieldset className="cal-surface-body" disabled={busy}>
          <CalendarFields {...{ name, color, setName, setColor }} />
          {error && (
            <p role="alert" className="cal-error">
              {error}
            </p>
          )}
        </fieldset>
        <footer className="cal-surface-footer">
          <button type="submit" className="cal-primary" disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : calendar ? 'Save calendar' : 'Create calendar'}
          </button>
        </footer>
      </form>
    </PanelSurface>
  )
}
