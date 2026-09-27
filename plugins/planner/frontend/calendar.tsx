import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Planner, PlannerItem } from '@sisyphus/sdk'
import { Editor } from './editor'
import { Icon } from './icons'
import { MoreActions } from './more-actions'
import { PanelSurface } from './panel-surface'
import { SearchResults } from './search-results'
import { TransferDialog, type TransferMode } from './transfer-dialog'
import {
  dateKey,
  fromDay,
  monthDays,
  occurrences,
  onDay,
  timeLabel,
  type Occurrence,
} from './model'
import './calendar.css'

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
type View = 'month' | 'agenda' | 'tasks'
type TaskFilter = { type: 'all' } | { type: 'starred' }
type Surface =
  | { type: 'edit'; item?: PlannerItem; day: string; kind: 'event' | 'todo' }
  | { type: 'day'; day: string }
  | { type: 'transfer'; mode: TransferMode }
const fullDate = (day: string) =>
  fromDay(day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
const monthOf = (day: string) => new Date(fromDay(day).getFullYear(), fromDay(day).getMonth(), 1)
const readSidebar = () => {
  try {
    const value = localStorage.getItem('sisyphus.calendar.sidebar')
    return value === null ? null : value === 'open'
  } catch {
    return null
  }
}

export function Calendar({ planner }: { planner: Planner }) {
  const state = useSyncExternalStore(planner.subscribe, planner.getSnapshot)
  const root = useRef<HTMLDivElement>(null),
    searchInput = useRef<HTMLInputElement>(null),
    sidebarToggle = useRef<HTMLButtonElement>(null),
    surfaceInvoker = useRef<HTMLElement | null>(null)
  const sidebarId = useId()
  const today = dateKey(new Date())
  const [month, setMonth] = useState(() => monthOf(today)),
    [selected, setSelected] = useState(today)
  const [view, setView] = useState<View>('month'),
    [taskFilter, setTaskFilter] = useState<TaskFilter>({ type: 'all' })
  const [sidebarPreference, setSidebarPreference] = useState<boolean | null>(readSidebar),
    [compact, setCompact] = useState(false)
  const [hiddenLists, setHiddenLists] = useState<Set<string>>(() => new Set())
  const allListsCheckbox = useRef<HTMLInputElement>(null)
  const [events, setEvents] = useState(true),
    [tasks, setTasks] = useState(true)
  const [draft, setDraft] = useState(''),
    [query, setQuery] = useState<string | null>(null)
  const [surface, setSurface] = useState<Surface | null>(null)
  const surfaceOpen = !!surface
  useEffect(() => {
    if (surfaceOpen || !surfaceInvoker.current) return
    const target = surfaceInvoker.current.isConnected
      ? surfaceInvoker.current
      : root.current?.querySelector<HTMLElement>(
          '.cal-day[data-selected="true"] .cal-day-number, .cal-create',
        )
    target?.focus()
  }, [surfaceOpen])
  const [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const sidebarOpen = sidebarPreference ?? !compact
  useEffect(() => {
    const observer = new ResizeObserver((entries) => setCompact(entries[0].contentRect.width < 720))
    observer.observe(root.current!)
    return () => observer.disconnect()
  }, [])
  const toggleSidebar = (next: boolean) => {
    setSidebarPreference(next)
    try {
      localStorage.setItem('sisyphus.calendar.sidebar', next ? 'open' : 'closed')
    } catch {
      /* still works without persistence */
    }
  }
  const closeDrawer = () => {
    if (compact) toggleSidebar(false)
  }
  const days = useMemo(() => monthDays(month), [month])
  const visible = useMemo(
    () =>
      state.records.filter((item) =>
        item.kind === 'event' ? events : tasks && !hiddenLists.has(item.list || 'My tasks'),
      ),
    [state.records, events, tasks, hiddenLists],
  )
  const schedule = useMemo(
    () => occurrences(visible, days[0], days[days.length - 1]),
    [visible, days],
  )
  const daySchedule = useMemo(
    () => (surface?.type === 'day' ? occurrences(visible, surface.day, surface.day) : null),
    [surface, visible],
  )
  const taskItems = state.records.filter(
    (item) =>
      item.kind === 'todo' &&
      !hiddenLists.has(item.list || 'My tasks') &&
      (taskFilter.type === 'all' || item.starred),
  )
  const lists = [
    ...new Set(state.records.filter((i) => i.kind === 'todo').map((i) => i.list || 'My tasks')),
  ]
  const openTasks = taskItems
    .filter((i) => !i.done)
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))
  const completed = taskItems.filter((i) => i.done)
  const selectedLists = lists.filter((list) => !hiddenLists.has(list))
  const allListsSelected = selectedLists.length === lists.length
  useEffect(() => {
    if (allListsCheckbox.current)
      allListsCheckbox.current.indeterminate = selectedLists.length > 0 && !allListsSelected
  }, [selectedLists.length, allListsSelected])
  const taskTitle = taskFilter.type === 'starred' ? 'Starred tasks' : 'Tasks'
  const endSearch = () => {
    setQuery(null)
    setDraft('')
  }
  const switchView = (next: View) => {
    setView(next)
    endSearch()
    closeDrawer()
  }
  const selectDay = (day: string) => {
    setSelected(day)
    setMonth(monthOf(day))
    endSearch()
    setView('month')
    closeDrawer()
  }
  const move = (offset: number) => {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1)
    setMonth(next)
    setSelected(dateKey(next))
  }
  const edit = (item: PlannerItem) =>
    setSurface({ type: 'edit', item, day: selected, kind: item.kind })
  const create = (day = selected, kind: 'event' | 'todo' = view === 'tasks' ? 'todo' : 'event') => {
    closeDrawer()
    setSurface({ type: 'edit', day, kind })
  }
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const chip = (entry: Occurrence) => (
    <button
      key={entry.key}
      className={`cal-chip cal-kind-${entry.item.kind}`}
      data-done={entry.item.done}
      title={`${timeLabel(entry)} · ${entry.item.title}`}
      onClick={() => edit(state.records.find((i) => i.id === entry.item.id)!)}
    >
      {entry.item.kind === 'todo' ? (
        <Icon name="tasks" size={13} />
      ) : (
        <span className="cal-event-dot" aria-hidden="true" />
      )}
      <span>
        {entry.start && <small>{timeLabel(entry)} </small>}
        {entry.item.title}
      </span>
    </button>
  )
  const entryRow = (entry: Occurrence) => (
    <button
      className="cal-schedule-entry"
      key={entry.key}
      onClick={() => edit(state.records.find((i) => i.id === entry.item.id)!)}
    >
      <span className={`cal-entry-marker cal-kind-${entry.item.kind}`} />
      <span className="cal-entry-time">
        {timeLabel(entry)}
        {entry.end && (
          <small>{entry.end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small>
        )}
      </span>
      <span className="cal-entry-description">
        <strong>{entry.item.title}</strong>
        {entry.item.location && <small>{entry.item.location}</small>}
      </span>
      <Icon name="right" size={14} />
    </button>
  )
  const taskRow = (item: PlannerItem) => (
    <div className="cal-task-row" key={item.id} data-done={item.done}>
      <input
        type="checkbox"
        aria-label={`${item.done ? 'Reopen' : 'Complete'} ${item.title}`}
        checked={!!item.done}
        disabled={busy}
        onChange={() => void act(() => planner.update(item.id, { done: !item.done }))}
      />
      <button className="cal-task-title" onClick={() => edit(item)}>
        <strong>{item.title}</strong>
        <small data-overdue={!item.done && !!item.date && item.date < today}>
          {item.date
            ? fromDay(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            : 'No due date'}
          {item.description ? ` · ${item.description}` : ''}
        </small>
      </button>
      <button
        className="cal-icon-button cal-star"
        title={item.starred ? 'Unstar task' : 'Star task'}
        aria-label={`Star ${item.title}`}
        aria-pressed={!!item.starred}
        disabled={busy}
        onClick={() => void act(() => planner.update(item.id, { starred: !item.starred }))}
      >
        <Icon name="star" size={17} />
      </button>
    </div>
  )
  const agendaDays = days.filter(
    (day) =>
      fromDay(day).getMonth() === month.getMonth() &&
      schedule.entries.some((entry) => onDay(entry, day)),
  )
  return (
    <div
      className="cal-app"
      ref={root}
      data-compact={compact}
      onFocusCapture={(event) => {
        if (!surface && (event.target as HTMLElement).closest('.cal-frame'))
          surfaceInvoker.current = event.target as HTMLElement
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !surface) {
          if (compact && sidebarOpen) {
            event.preventDefault()
            toggleSidebar(false)
            sidebarToggle.current?.focus()
          } else if (query) {
            event.preventDefault()
            endSearch()
            searchInput.current?.focus()
          }
        }
        if (
          event.key === '/' &&
          !surface &&
          !(event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')
        ) {
          event.preventDefault()
          searchInput.current?.focus()
        }
      }}
    >
      <div className="cal-frame" inert={!!surface}>
        <header className="cal-toolbar">
          <button
            ref={sidebarToggle}
            className="cal-icon-button"
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-expanded={sidebarOpen}
            aria-controls={sidebarId}
            onClick={() => toggleSidebar(!sidebarOpen)}
          >
            <Icon name="sidebar" />
          </button>
          <div className="cal-brand">
            <Icon name="calendar" size={21} />
            <strong>Calendar</strong>
          </div>
          <form
            className="cal-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault()
              if (draft.trim()) {
                setQuery(draft.trim())
                closeDrawer()
              }
            }}
          >
            <button
              className="cal-icon-button"
              aria-label="Search"
              title="Search"
              disabled={!draft.trim()}
            >
              <Icon name="search" size={17} />
            </button>
            <input
              ref={searchInput}
              role="searchbox"
              aria-label="Search calendar"
              placeholder="Search calendar"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  endSearch()
                  event.currentTarget.blur()
                }
              }}
            />
            {draft && (
              <button
                type="button"
                className="cal-icon-button"
                title="Clear search"
                aria-label="Clear search"
                onClick={() => {
                  endSearch()
                  searchInput.current?.focus()
                }}
              >
                <Icon name="close" size={15} />
              </button>
            )}
          </form>
          <button
            className="cal-primary cal-create"
            aria-label="Create"
            title="Create event or task"
            onClick={() => create()}
          >
            <Icon name="plus" size={17} />
            <span>Create</span>
          </button>
          <MoreActions
            choose={(mode) => {
              closeDrawer()
              setSurface({ type: 'transfer', mode })
            }}
          />
        </header>
        <div className="cal-layout">
          {compact && (
            <button
              className="cal-sidebar-scrim"
              data-open={sidebarOpen}
              aria-hidden={!sidebarOpen}
              tabIndex={-1}
              aria-label="Close sidebar"
              onClick={() => toggleSidebar(false)}
            />
          )}
          <div className="cal-sidebar-shell" data-open={sidebarOpen}>
            <aside
              id={sidebarId}
              className="cal-sidebar"
              aria-label="Calendar sidebar"
              inert={!sidebarOpen}
              aria-hidden={!sidebarOpen}
            >
              <div className="cal-sidebar-scroll">
                <div className="cal-mini-heading">
                  <strong>
                    {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                  </strong>
                  <div>
                    <button
                      className="cal-icon-button"
                      aria-label="Previous mini-calendar month"
                      onClick={() => move(-1)}
                    >
                      <Icon name="left" size={14} />
                    </button>
                    <button
                      className="cal-icon-button"
                      aria-label="Next mini-calendar month"
                      onClick={() => move(1)}
                    >
                      <Icon name="right" size={14} />
                    </button>
                  </div>
                </div>
                <div className="cal-mini">
                  {weekdays.map((day) => (
                    <small key={day}>{day[0]}</small>
                  ))}
                  {days.map((day) => (
                    <button
                      key={day}
                      data-outside={fromDay(day).getMonth() !== month.getMonth()}
                      data-today={day === today}
                      aria-pressed={day === selected}
                      aria-label={fullDate(day)}
                      onClick={() => selectDay(day)}
                    >
                      {fromDay(day).getDate()}
                    </button>
                  ))}
                </div>
                <section className="cal-sidebar-section">
                  <h3>Show on calendar</h3>
                  <label className="cal-check">
                    <input
                      type="checkbox"
                      checked={events}
                      onChange={(e) => setEvents(e.target.checked)}
                    />
                    <span className="cal-swatch" />
                    Events
                  </label>
                  <label className="cal-check">
                    <input
                      type="checkbox"
                      checked={tasks}
                      onChange={(e) => setTasks(e.target.checked)}
                    />
                    <span className="cal-swatch cal-kind-todo" />
                    Tasks
                  </label>
                </section>
                <section className="cal-sidebar-section">
                  <h3>Task lists</h3>
                  <button
                    className="cal-side-link"
                    aria-current={
                      view === 'tasks' && !query && taskFilter.type === 'all' ? 'page' : undefined
                    }
                    onClick={() => {
                      setTaskFilter({ type: 'all' })
                      switchView('tasks')
                    }}
                  >
                    <Icon name="tasks" size={17} />
                    <span>Tasks</span>
                    <small>
                      {state.records.filter((i) => i.kind === 'todo' && !i.done).length}
                    </small>
                  </button>
                  <button
                    className="cal-side-link"
                    aria-current={
                      view === 'tasks' && !query && taskFilter.type === 'starred'
                        ? 'page'
                        : undefined
                    }
                    onClick={() => {
                      setTaskFilter({ type: 'starred' })
                      switchView('tasks')
                    }}
                  >
                    <Icon name="star" size={17} />
                    <span>Starred</span>
                  </button>
                  <label className="cal-check cal-list-choice">
                    <input
                      ref={allListsCheckbox}
                      type="checkbox"
                      checked={allListsSelected && lists.length > 0}
                      disabled={!lists.length}
                      onChange={(event) =>
                        setHiddenLists(event.target.checked ? new Set() : new Set(lists))
                      }
                    />
                    <span>All lists</span>
                  </label>
                  {lists.map((list) => (
                    <label className="cal-check cal-list-choice" key={list}>
                      <input
                        type="checkbox"
                        checked={!hiddenLists.has(list)}
                        onChange={(event) => {
                          const checked = event.target.checked
                          setHiddenLists((previous) => {
                            const next = new Set(previous)
                            if (checked) next.delete(list)
                            else next.add(list)
                            return next
                          })
                        }}
                      />
                      <span title={list}>{list}</span>
                    </label>
                  ))}
                </section>
              </div>
              <div className="cal-sidebar-footer">
                <Icon name="clock" size={14} />
                <span>
                  {Intl.DateTimeFormat()
                    .resolvedOptions()
                    .timeZone.split('/')
                    .pop()
                    ?.replaceAll('_', ' ')}
                </span>
              </div>
            </aside>
          </div>
          <main className="cal-content" inert={compact && sidebarOpen}>
            {!query && (
              <div className="cal-viewbar">
                {view !== 'tasks' && (
                  <div className="cal-date-navigation">
                    <button
                      className="cal-today"
                      onClick={() => {
                        setMonth(monthOf(today))
                        setSelected(today)
                      }}
                    >
                      Today
                    </button>
                    <button
                      className="cal-icon-button"
                      aria-label="Previous month"
                      onClick={() => move(-1)}
                    >
                      <Icon name="left" />
                    </button>
                    <button
                      className="cal-icon-button"
                      aria-label="Next month"
                      onClick={() => move(1)}
                    >
                      <Icon name="right" />
                    </button>

                  </div>
                )}
                <h2>
                  {view === 'tasks'
                    ? taskTitle
                    : month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                </h2>
                
                <select
                  aria-label="Calendar view"
                  value={view}
                  onChange={(e) => switchView(e.target.value as View)}
                >
                  <option value="month">Month</option>
                  <option value="agenda">Agenda</option>
                  <option value="tasks">Tasks</option>
                </select>
              </div>
            )}
            {(error || state.error) && (
              <div className="cal-feedback cal-error" role="alert">
                {error || state.error}
              </div>
            )}
            {notice && (
              <div className="cal-toast" role="status">
                <Icon name="check" size={16} />
                {notice}
                <button
                  className="cal-icon-button"
                  aria-label="Dismiss notification"
                  onClick={() => setNotice('')}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            )}
            {!query && view !== 'tasks' && schedule.warnings.length > 0 && (
              <details className="cal-notices">
                <summary>
                  {schedule.warnings.length} imported schedule{' '}
                  {schedule.warnings.length === 1 ? 'notice' : 'notices'}
                </summary>
                {schedule.warnings.map((warning, i) => (
                  <p key={i}>{warning}</p>
                ))}
              </details>
            )}
            {query ? (
              <SearchResults
                key={query}
                records={state.records}
                query={query}
                edit={edit}
                back={endSearch}
                reveal={(item) => {
                  const day = item.start ? dateKey(new Date(item.start)) : item.date!
                  selectDay(day)
                  if (item.kind === 'event') setEvents(true)
                  else {
                    setTasks(true)
                    setHiddenLists((previous) => {
                      const next = new Set(previous)
                      next.delete(item.list || 'My tasks')
                      return next
                    })
                  }
                  setSurface({ type: 'day', day })
                }}
              />
            ) : view === 'month' ? (
              <div className="cal-month">
                <div className="cal-weekdays">
                  {weekdays.map((day) => (
                    <span key={day}>{day}</span>
                  ))}
                </div>
                <div
                  className="cal-month-grid"
                  style={{ gridTemplateRows: `repeat(${days.length / 7}, minmax(86px, 1fr))` }}
                >
                  {days.map((day) => {
                    const entries = schedule.entries.filter((entry) => onDay(entry, day))
                    return (
                      <div
                        className="cal-day"
                        key={day}
                        data-outside={fromDay(day).getMonth() !== month.getMonth()}
                        data-selected={day === selected}
                        onDoubleClick={(event) => {
                          if (!(event.target as HTMLElement).closest('button')) create(day, 'event')
                        }}
                      >
                        <button
                          className="cal-day-number"
                          data-today={day === today}
                          aria-label={`View ${fullDate(day)}, ${entries.length} ${entries.length === 1 ? 'item' : 'items'}`}
                          onClick={() => {
                            setSelected(day)
                            setSurface({ type: 'day', day })
                          }}
                        >
                          {fromDay(day).getDate() === 1
                            ? fromDay(day).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                              })
                            : fromDay(day).getDate()}
                        </button>
                        <div className="cal-day-items">
                          {entries.slice(0, 3).map(chip)}
                          {entries.length > 3 && (
                            <button
                              className="cal-more-items"
                              onClick={() => {
                                setSelected(day)
                                setSurface({ type: 'day', day })
                              }}
                            >
                              {entries.length - 3} more
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {!events && !tasks && (
                  <div className="cal-filter-hint">
                    Events and tasks are hidden.{' '}
                    <button
                      onClick={() => {
                        setEvents(true)
                        setTasks(true)
                      }}
                    >
                      Show all
                    </button>
                  </div>
                )}
              </div>
            ) : view === 'agenda' ? (
              <div className="cal-agenda">
                {agendaDays.length ? (
                  agendaDays.map((day) => (
                    <section key={day} className="cal-agenda-day">
                      <div className="cal-agenda-date">
                        <strong data-today={day === today}>{fromDay(day).getDate()}</strong>
                        <span>
                          {fromDay(day).toLocaleDateString(undefined, { weekday: 'short' })}
                        </span>
                      </div>
                      <div className="cal-agenda-items">
                        {schedule.entries.filter((entry) => onDay(entry, day)).map(entryRow)}
                      </div>
                    </section>
                  ))
                ) : (
                  <div className="cal-empty">
                    <Icon name="calendar" size={30} />
                    <h3>
                      {events || tasks ? 'Nothing scheduled this month' : 'Everything is hidden'}
                    </h3>
                    <p>
                      {events || tasks
                        ? 'Use Create to add an event or task.'
                        : 'Show events or tasks in the sidebar to see your schedule.'}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="cal-tasks">
                <p className="cal-task-count">
                  {openTasks.length} open
                  {completed.length ? ` · ${completed.length} completed` : ''}
                </p>
                {openTasks.length ? (
                  <div className="cal-task-groups">
                    {[...new Set(openTasks.map((i) => i.list || 'My tasks'))].map((list) => (
                      <section key={list}>
                        <h3>{list}</h3>
                        {openTasks.filter((i) => (i.list || 'My tasks') === list).map(taskRow)}
                      </section>
                    ))}
                  </div>
                ) : (
                  <div className="cal-empty">
                    <Icon name={taskFilter.type === 'starred' ? 'star' : 'tasks'} size={30} />
                    <h3>
                      {lists.length > 0 && selectedLists.length === 0
                        ? 'No task lists selected'
                        : completed.length
                          ? 'All tasks complete'
                          : taskFilter.type === 'starred'
                            ? 'No starred tasks'
                            : 'No tasks yet'}
                    </h3>
                    <p>
                      {lists.length > 0 && selectedLists.length === 0
                        ? 'Select one or more task lists in the sidebar.'
                        : taskFilter.type === 'starred'
                          ? 'Star a task to find it here.'
                          : 'Use Create to add a task.'}
                    </p>
                  </div>
                )}
                {completed.length > 0 && (
                  <details className="cal-completed">
                    <summary>
                      <Icon name="chevron" size={14} />
                      Completed ({completed.length})
                    </summary>
                    {completed.map(taskRow)}
                  </details>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
      {surface?.type === 'transfer' && (
        <TransferDialog
          planner={planner}
          folder={state.folder}
          mode={surface.mode}
          close={() => setSurface(null)}
        />
      )}
      {surface?.type === 'edit' && (
        <Editor
          {...surface}
          defaultList={selectedLists.length === 1 ? selectedLists[0] : undefined}
          planner={planner}
          close={() => setSurface(null)}
          saved={(message) => {
            setNotice(message)
            setSurface(null)
          }}
        />
      )}
      {surface?.type === 'day' && (
        <PanelSurface
          title={fullDate(surface.day)}
          close={() => setSurface(null)}
          dismissOnBackdrop
        >
          <div className="cal-surface-body cal-day-schedule">
            {daySchedule?.warnings.map((warning, i) => (
              <p className="cal-footnote" key={i}>
                {warning}
              </p>
            ))}
            {daySchedule?.entries.length ? (
              daySchedule.entries.map(entryRow)
            ) : (
              <div className="cal-empty">
                <Icon name="calendar" size={28} />
                <h3>Nothing scheduled</h3>
                <p>Add an event to this day.</p>
              </div>
            )}
          </div>
          <footer className="cal-surface-footer">
            <button className="cal-primary" onClick={() => create(surface.day, 'event')}>
              <Icon name="plus" size={17} />
              Add event
            </button>
          </footer>
        </PanelSurface>
      )}
    </div>
  )
}
