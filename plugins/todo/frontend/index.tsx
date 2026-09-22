import { useState, useSyncExternalStore } from 'react'
import { services, type AppPlugin, type Panels, type Planner } from '@sisyphus/sdk'
import icon from './icon.svg'
import './todo.css'

export const todoPlugin: AppPlugin = {
  id: 'feature.todo', name: 'To-dos', inject: [services.panels, services.planner],
  apply(ctx) {
    const panels = ctx.get(services.panels) as Panels
    const planner = ctx.get(services.planner) as Planner
    function Todo() {
      const state = useSyncExternalStore(planner.subscribe, planner.getSnapshot)
      const [title, setTitle] = useState('')
      const [date, setDate] = useState('')
      const [busy, setBusy] = useState(false)
      const act = (work: Promise<unknown>) => void work.catch(() => {})
      return <div className="todo-panel">
        <header><h2>To-dos</h2><p>Give a task a date to see it on your calendar.</p></header>
        <form className="todo-add" onSubmit={event => {
          event.preventDefault()
          if (!title.trim() || busy) return
          setBusy(true)
          void planner.create({ title, date: date || undefined }).then(() => { setTitle(''); setDate('') }).catch(() => {}).finally(() => setBusy(false))
        }}>
          <input aria-label="Title" placeholder="Add a task…" value={title} onChange={event => setTitle(event.target.value)} maxLength={500} />
          <input type="date" aria-label="Task date (optional)" value={date} onChange={event => setDate(event.target.value)} />
          <button type="submit" disabled={busy || !title.trim()}>Add</button>
        </form>
        <div className="todo-count">{state.records.filter(item => !item.done).length} open</div>
        {[...state.records].sort((a, b) => Number(!!a.done) - Number(!!b.done) || (a.date || '9999').localeCompare(b.date || '9999')).map(item =>
          <div className="todo-row" data-done={!!item.done} key={item.id}>
            <input type="checkbox" aria-label={`Complete ${item.title}`} checked={!!item.done} onChange={() => act(planner.update(item.id, { done: !item.done }))} />
            <span>{item.title}</span>
            <input type="date" aria-label={`Date for ${item.title}`} value={item.date ?? ''} onChange={event => act(planner.update(item.id, { date: event.target.value || null }))} />
            <button aria-label={`Delete ${item.title}`} onClick={() => act(planner.remove(item.id))}>×</button>
          </div>)}
        {!state.records.length && <p className="todo-empty">Nothing on your list yet.</p>}
        <details className="todo-sync"><summary>File sync</summary>
          <p>{state.folder || 'Choose a folder mirrored by your cloud provider.'}</p>
          <button onClick={() => act(planner.chooseFolder())}>Choose folder</button>
          <button disabled={!state.folder} onClick={() => act(planner.sync())}>Sync now</button>
        </details>
        {state.error && <p role="alert">{state.error}</p>}
      </div>
    }
    ctx.effect(() => panels.register({ id: 'todo', title: 'To-dos', icon,
      description: 'Tasks with optional calendar dates.', component: Todo }))
  },
}
