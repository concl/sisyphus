import { useState, useSyncExternalStore } from 'react'
import { services, type AppPlugin, type Panels, type Planner } from '@sisyphus/sdk'
import icon from './icon.svg'
import './calendar.css'

const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
export const calendarPlugin: AppPlugin = {
  id: 'feature.calendar', name: 'Calendar', inject: [services.panels, services.planner],
  apply(ctx) {
    const panels = ctx.get(services.panels) as Panels
    const planner = ctx.get(services.planner) as Planner
    function Calendar() {
      const state = useSyncExternalStore(planner.subscribe, planner.getSnapshot)
      const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
      const [selected, setSelected] = useState(() => dateKey(new Date()))
      const [title, setTitle] = useState('')
      const [busy, setBusy] = useState(false)
      const year = month.getFullYear(), index = month.getMonth()
      const offset = month.getDay(), count = new Date(year,index+1,0).getDate()
      const dated = state.records.filter(item => item.date)
      const act = (work: Promise<unknown>) => void work.catch(() => {})
      return <div className="calendar-panel">
        <header><h2>Calendar</h2><p>Every dated task, in one place.</p></header>
        <div className="calendar-month"><strong>{month.toLocaleDateString(undefined,{ month:'long',year:'numeric' })}</strong>
          <div><button aria-label="Previous month" onClick={() => setMonth(new Date(year,index-1,1))}>‹</button>
          <button aria-label="Next month" onClick={() => setMonth(new Date(year,index+1,1))}>›</button></div>
        </div>
        <div className="calendar-grid">
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day => <b key={day}>{day}</b>)}
          {Array.from({ length: offset }, (_,i) => <span key={`blank-${i}`} />)}
          {Array.from({ length: count }, (_,i) => {
            const date = dateKey(new Date(year,index,i+1))
            const items = dated.filter(item => item.date === date)
            return <button key={date} aria-label={`${date}, ${items.length} tasks`} aria-pressed={selected === date} data-today={date === dateKey(new Date())} onClick={() => setSelected(date)}>
              {i+1}{!!items.length && <small>{items.length}</small>}
            </button>
          })}
        </div>
        <h3>{new Date(`${selected}T12:00:00`).toLocaleDateString(undefined,{ weekday:'long',month:'short',day:'numeric' })}</h3>
        <form onSubmit={event => {
          event.preventDefault()
          if (!title.trim() || busy) return
          setBusy(true)
          void planner.create({ title, date: selected }).then(() => setTitle('')).catch(() => {}).finally(() => setBusy(false))
        }}><input aria-label="Task title" placeholder="Add a task on this day…" value={title} maxLength={500} onChange={event => setTitle(event.target.value)} /><button disabled={busy || !title.trim()}>Add</button></form>
        {dated.filter(item => item.date === selected).map(item => <div className="calendar-item" key={item.id} data-done={!!item.done}>
          <input type="checkbox" checked={!!item.done} aria-label={`Complete ${item.title}`} onChange={() => act(planner.update(item.id,{ done: !item.done }))} />
          <span>{item.title}</span>
          <input type="date" aria-label={`Date for ${item.title}`} value={item.date} onChange={event => act(planner.update(item.id,{ date: event.target.value || null }))} />
          <button title="Keep task without a date" aria-label={`Unschedule ${item.title}`} onClick={() => act(planner.update(item.id,{ date: null }))}>×</button>
        </div>)}
        {!dated.some(item => item.date === selected) && <p className="calendar-empty">Nothing scheduled.</p>}
        {state.error && <p role="alert">{state.error}</p>}
      </div>
    }
    ctx.effect(() => panels.register({ id: 'calendar', title: 'Calendar', icon,
      description: 'Dated tasks from your shared planner.', component: Calendar }))
  },
}
