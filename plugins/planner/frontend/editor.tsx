import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Planner, PlannerItem, PlannerChanges } from '@sisyphus/sdk'
import { addDays, dateKey, fromDay } from './model'
import { PanelSurface } from './panel-surface'
import { Icon } from './icons'

const localTime = (value?: string | null) =>
  value
    ? new Date(value).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : ''
export function Editor({
  item,
  day,
  kind,
  defaultList,
  planner,
  close,
  saved,
}: {
  item?: PlannerItem
  day: string
  kind: 'event' | 'todo'
  defaultList?: string
  planner: Planner
  close: () => void
  saved: (message: string) => void
}) {
  const [title, setTitle] = useState(item?.title || '')
  const [type, setType] = useState(item?.kind || kind)
  const [date, setDate] = useState(
    item?.start ? dateKey(new Date(item.start)) : item?.date || (kind === 'event' ? day : ''),
  )
  const [last, setLast] = useState(
    item?.end
      ? dateKey(new Date(item.end))
      : item?.endDate
        ? addDays(item.endDate, -1)
        : date || day,
  )
  const [timed, setTimed] = useState(!!item?.start)
  const [start, setStart] = useState(localTime(item?.start) || '09:00')
  const [end, setEnd] = useState(localTime(item?.end) || '10:00')
  const [location, setLocation] = useState(item?.location || '')
  const [description, setDescription] = useState(item?.description || '')
  const [list, setList] = useState(item?.list || defaultList || 'My tasks')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [confirm, setConfirm] = useState<'discard' | 'delete' | null>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const keepEditing = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (confirm) keepEditing.current?.focus()
    else titleInput.current?.focus()
  }, [confirm])
  const current = JSON.stringify([
    title,
    type,
    date,
    last,
    timed,
    start,
    end,
    location,
    description,
    list,
  ])
  const [initial] = useState(current)
  const requestClose = () => {
    if (current === initial) close()
    else setConfirm('discard')
  }
  const perform = async (work: () => Promise<unknown>, message: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await work()
      saved(message)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void perform(
      async () => {
        const changes: PlannerChanges = {
          title,
          location,
          description,
          ...(type === 'todo' ? { list } : {}),
        }
        if (!item?.ical) {
          changes.kind = type
          changes.date = date || null
          changes.start =
            type === 'event' && timed ? new Date(`${date}T${start}`).toISOString() : null
          changes.end = type === 'event' && timed ? new Date(`${last}T${end}`).toISOString() : null
          changes.endDate = type === 'event' && !timed ? addDays(last, 1) : null
        }
        return item ? planner.update(item.id, changes) : planner.create({ ...changes, title })
      },
      `${type === 'event' ? 'Event' : 'Task'} ${item ? 'updated' : 'created'}.`,
    )
  }
  return (
    <PanelSurface
      title={`${item ? 'Edit' : 'New'} ${type === 'event' ? 'event' : 'task'}`}
      close={requestClose}
      busy={busy}
    >
      <form className="cal-editor-form" onSubmit={submit}>
        <fieldset disabled={busy || !!confirm} className="cal-surface-body">
          <label className="cal-title-label">
            <span className="cal-sr-only">Title</span>
            <input
              ref={titleInput}
              className="cal-title-input"
              data-autofocus
              required
              aria-label="Title"
              placeholder={type === 'event' ? 'Event title' : 'Task title'}
              maxLength={500}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          {!item && (
            <div className="cal-segments" aria-label="Item type">
              <button
                type="button"
                aria-pressed={type === 'event'}
                onClick={() => {
                  setType('event')
                  if (!date) setDate(day)
                }}
              >
                <Icon name="calendar" size={16} />
                Event
              </button>
              <button type="button" aria-pressed={type === 'todo'} onClick={() => setType('todo')}>
                <Icon name="tasks" size={16} />
                Task
              </button>
            </div>
          )}
          {item?.ical ? (
            <div className="cal-imported-info">
              <Icon name="calendar" />
              <div>
                <strong>
                  {item.date
                    ? fromDay(item.date).toLocaleDateString(undefined, {
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : 'Imported task'}
                </strong>
                <p>To change this imported schedule, edit it in its source calendar.</p>
              </div>
            </div>
          ) : (
            <>
              {type === 'event' && (
                <label className="cal-check">
                  <input
                    type="checkbox"
                    checked={!timed}
                    onChange={(e) => setTimed(!e.target.checked)}
                  />
                  All day
                </label>
              )}
              <div className="cal-form-row">
                <label>
                  {type === 'todo' ? 'Due date (optional)' : 'Start date'}
                  <input
                    type="date"
                    required={type === 'event'}
                    value={date}
                    onChange={(e) => {
                      setDate(e.target.value)
                      if (e.target.value > last) setLast(e.target.value)
                    }}
                  />
                </label>
                {type === 'event' && (
                  <label>
                    End date
                    <input
                      type="date"
                      required
                      min={date}
                      value={last}
                      onChange={(e) => setLast(e.target.value)}
                    />
                  </label>
                )}
              </div>
              {type === 'event' && timed && (
                <>
                  <div className="cal-form-row">
                    <label>
                      Start time
                      <input
                        type="time"
                        required
                        value={start}
                        onChange={(e) => setStart(e.target.value)}
                      />
                    </label>
                    <label>
                      End time
                      <input
                        type="time"
                        required
                        value={end}
                        onChange={(e) => setEnd(e.target.value)}
                      />
                    </label>
                  </div>
                  <p className="cal-footnote">
                    {Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_', ' ')}
                  </p>
                </>
              )}
            </>
          )}
          {type === 'event' ? (
            <label>
              Location
              <input
                value={location}
                maxLength={2000}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Place or meeting link"
              />
            </label>
          ) : (
            <label>
              List
              <input
                value={list}
                required
                maxLength={100}
                onChange={(e) => setList(e.target.value)}
              />
            </label>
          )}
          <label>
            Notes
            <textarea
              rows={4}
              value={description}
              maxLength={20000}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add details"
            />
          </label>
          {error && (
            <p role="alert" className="cal-feedback cal-error">
              {error}
            </p>
          )}
        </fieldset>
        {confirm ? (
          <div className="cal-inline-confirm" role="alert">
            <p>
              {confirm === 'delete'
                ? `Delete this ${type === 'event' ? 'event' : 'task'}?`
                : 'Discard your unsaved changes?'}
            </p>
            <div className="cal-button-row">
              <button
                ref={keepEditing}
                type="button"
                disabled={busy}
                onClick={() => setConfirm(null)}
              >
                Keep editing
              </button>
              <button
                type="button"
                className="cal-danger"
                disabled={busy}
                onClick={() =>
                  confirm === 'delete' && item
                    ? void perform(() => planner.remove(item.id), 'Item deleted.')
                    : close()
                }
              >
                {confirm === 'delete' ? 'Delete' : 'Discard'}
              </button>
            </div>
          </div>
        ) : (
          <footer className="cal-surface-footer">
            {item && (
              <button
                type="button"
                className="cal-delete"
                disabled={busy}
                onClick={() => setConfirm('delete')}
              >
                Delete
              </button>
            )}
            <span />
            <button type="button" disabled={busy} onClick={requestClose}>
              Cancel
            </button>
            <button className="cal-primary" disabled={busy || !title.trim()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </footer>
        )}
      </form>
    </PanelSurface>
  )
}
