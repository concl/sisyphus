import { useEffect, useState } from 'react'
import { services, type AppPlugin, type Desktop, type Panels } from '@sisyphus/sdk'
import icon from './icon.svg'
import './planner.css'

type Item = {
  id: string
  kind: 'todo' | 'event'
  title: string
  date?: string
  done?: boolean
  deleted?: boolean
  updatedAt: string
  actor: string
}
type Document = { schema: 1; records: Item[] }
const empty = (): Document => ({ schema: 1, records: [] })
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
const monthLabel = (date: Date) =>
  date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

export const plannerPlugin: AppPlugin = {
  id: 'feature.planner',
  name: 'Planner',
  inject: [services.panels, services.desktop],
  apply(ctx) {
    const panels = ctx.get(services.panels) as Panels
    const desktop = ctx.get(services.desktop) as Desktop

    function Planner() {
      const [document, setDocument] = useState<Document>(empty)
      const [title, setTitle] = useState('')
      const [kind, setKind] = useState<'todo' | 'event'>('todo')
      const [date, setDate] = useState(today)
      const [month, setMonth] = useState(
        () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      )
      const [folder, setFolder] = useState<string | null>(null)
      const [message, setMessage] = useState('')
      const [busy, setBusy] = useState(false)

      useEffect(() => {
        let alive = true
        const off = desktop.on<Document>('planner.changed', saved => { if (alive) setDocument(saved) })
        void desktop
          .call<Document>('planner.get')
          .then((saved) => {
            if (alive && saved?.schema === 1 && Array.isArray(saved.records)) {
              setDocument(saved)
            }
          })
          .catch((error) => setMessage(String(error)))
        void desktop
          .call<{ folder: string | null }>('planner.sync.status')
          .then((result) => {
            if (alive) setFolder(result.folder)
          })
          .catch(() => {})
        return () => {
          alive = false
          off()
        }
      }, [])

      function update(item: Item, changes: Partial<Item>) {
        void desktop.call(changes.deleted ? 'planner.remove' : 'planner.update', changes.deleted ? { id: item.id } : { id: item.id, ...changes }).catch(error => setMessage(String(error)))
      }
      function add() {
        const value = title.trim()
        if (!value || (kind === 'event' && !date)) return
        const item = {
          kind,
          title: value,
          date: kind === 'event' ? date : undefined,
        }
        void desktop.call('planner.create', item).then(() => setTitle('')).catch(error => setMessage(String(error)))
      }
      async function chooseFolder() {
        try {
          const result = await desktop.call<{ folder: string | null }>('planner.sync.chooseFolder')
          setFolder(result.folder)
        } catch (error) {
          setMessage(String(error))
        }
      }
      async function sync() {
        setBusy(true)
        try {
          const merged = await desktop.call<Document>('planner.sync.now')
          setDocument(merged)
          setMessage('Planner synced successfully.')
        } catch (error) {
          setMessage(String(error))
        } finally {
          setBusy(false)
        }
      }

      const items = document.records.filter((item) => !item.deleted)
      const todos = items
        .filter((item) => item.kind === 'todo')
        .sort((a, b) => Number(!!a.done) - Number(!!b.done))
      const events = items.filter((item) => item.kind === 'event')
      const year = month.getFullYear()
      const index = month.getMonth()
      const offset = new Date(year, index, 1).getDay()
      const count = new Date(year, index + 1, 0).getDate()
      const days = Array.from({ length: offset + count }, (_, i) =>
        i < offset ? null : i - offset + 1,
      )
      const selectedEvents = events
        .filter((item) => item.date?.startsWith(`${year}-${String(index + 1).padStart(2, '0')}`))
        .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))

      return (
        <div className="planner-panel">
          <div className="planner-top">
            <div>
              <span className="eyebrow">YOUR TIME & TASKS</span>
              <h2>Planner</h2>
              <p className="muted">A small place to keep track of what matters.</p>
            </div>
            <img src={icon} alt="" />
          </div>
          <form
            className="planner-add"
            onSubmit={(event) => {
              event.preventDefault()
              add()
            }}
          >
            <select
              aria-label="Item type"
              value={kind}
              onChange={(event) => setKind(event.target.value as 'todo' | 'event')}
            >
              <option value="todo">To-do</option>
              <option value="event">Event</option>
            </select>
            <input
              aria-label="Title"
              placeholder={kind === 'todo' ? 'Add a to-do…' : 'Add an event…'}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={500}
            />
            {kind === 'event' && (
              <input
                aria-label="Event date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            )}
            <button className="primary" type="submit">
              Add
            </button>
          </form>
          <div className="planner-columns">
            <section className="planner-todos">
              <div className="section-label">
                TO-DOS <span>{todos.filter((item) => !item.done).length} OPEN</span>
              </div>
              {todos.length ? (
                todos.map((item) => (
                  <div className={`planner-item ${item.done ? 'done' : ''}`} key={item.id}>
                    <input
                      type="checkbox"
                      aria-label={`Complete ${item.title}`}
                      checked={!!item.done}
                      onChange={() => update(item, { done: !item.done })}
                    />
                    <span>{item.title}</span>
                    <button
                      aria-label={`Delete ${item.title}`}
                      title="Delete"
                      onClick={() => update(item, { deleted: true })}
                    >
                      ×
                    </button>
                  </div>
                ))
              ) : (
                <p className="planner-empty">Nothing on your list yet.</p>
              )}
            </section>
            <section className="planner-calendar">
              <div className="planner-month">
                <strong>{monthLabel(month)}</strong>
                <span>
                  <button
                    aria-label="Previous month"
                    onClick={() => setMonth(new Date(year, index - 1, 1))}
                  >
                    ‹
                  </button>
                  <button
                    aria-label="Next month"
                    onClick={() => setMonth(new Date(year, index + 1, 1))}
                  >
                    ›
                  </button>
                </span>
              </div>
              <div className="planner-grid">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                  <b key={i}>{day}</b>
                ))}
                {days.map((day, i) => {
                  const key = `${year}-${String(index + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                  return (
                    <div
                      key={i}
                      className={`${day && key === today() ? 'today' : ''} ${events.some((item) => item.date === key) ? 'has-event' : ''}`}
                    >
                      {day}
                    </div>
                  )
                })}
              </div>
              <div className="section-label">EVENTS THIS MONTH</div>
              {selectedEvents.length ? (
                selectedEvents.map((item) => (
                  <div className="planner-event" key={item.id}>
                    <time>{item.date?.slice(8)}</time>
                    <span>{item.title}</span>
                    <button
                      aria-label={`Delete ${item.title}`}
                      onClick={() => update(item, { deleted: true })}
                    >
                      ×
                    </button>
                  </div>
                ))
              ) : (
                <p className="planner-empty">No events this month.</p>
              )}
            </section>
          </div>
          <div className="planner-sync">
            <div>
              <strong>File sync</strong>
              <p>
                {folder
                  ? `Connected to ${folder}`
                  : 'Choose a folder mirrored by your cloud provider.'}
              </p>
            </div>
            <button onClick={() => void chooseFolder()}>Choose folder</button>
            <button disabled={!folder || busy} onClick={() => void sync()}>
              {busy ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
          {message && (
            <p className="planner-message" role="status">
              {message}
            </p>
          )}
        </div>
      )
    }
    ctx.effect(() =>
      panels.register({
        id: 'planner',
        title: 'Planner',
        description: 'To-dos, events, and file sync.',
        icon,
        component: Planner,
      }),
    )
  },
}
