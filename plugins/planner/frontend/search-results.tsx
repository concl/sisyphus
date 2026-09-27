import { useMemo, useState } from 'react'
import type { PlannerItem } from '@sisyphus/sdk'
import { Icon } from './icons'
import { searchRecords } from './search'
import { fromDay } from './model'

export function SearchResults({
  records,
  query,
  edit,
  reveal,
  back,
}: {
  records: PlannerItem[]
  query: string
  edit: (item: PlannerItem) => void
  reveal: (item: PlannerItem) => void
  back: () => void
}) {
  const [kind, setKind] = useState<'all' | 'event' | 'todo'>('all')
  const matches = useMemo(() => searchRecords(records, query), [records, query])
  const results = matches.filter((item) => kind === 'all' || item.kind === kind)
  return (
    <section className="cal-results" aria-label="Search results">
      <header className="cal-view-heading">
        <div>
          <h2>Search results</h2>
          <p role="status">
            {results.length} {results.length === 1 ? 'result' : 'results'} for{' '}
            <strong>“{query}”</strong> <span>across all dates</span>
          </p>
        </div>
        <button className="cal-text-button" onClick={back}>
          <Icon name="left" />
          Back to calendar
        </button>
      </header>
      <div className="cal-filter-tabs" aria-label="Result type">
        {(['all', 'event', 'todo'] as const).map((type) => (
          <button key={type} aria-pressed={kind === type} onClick={() => setKind(type)}>
            {type === 'all' ? 'All' : type === 'event' ? 'Events' : 'Tasks'}
            <span>{matches.filter((i) => type === 'all' || i.kind === type).length}</span>
          </button>
        ))}
      </div>
      {results.length ? (
        <div className="cal-result-list">
          {results.map((item) => (
            <article key={item.id} className="cal-result" data-done={item.done}>
              <span className={`cal-result-icon cal-kind-${item.kind}`}>
                <Icon name={item.kind === 'event' ? 'calendar' : 'tasks'} />
              </span>
              <button className="cal-result-open" onClick={() => edit(item)}>
                <strong>{item.title}</strong>
                <span>
                  {item.date
                    ? fromDay(item.date).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : 'No due date'}
                  {item.start
                    ? ` · ${new Date(item.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                    : ''}
                  {item.kind === 'todo'
                    ? ` · ${item.done ? 'Completed' : item.list || 'My tasks'}`
                    : ''}
                  {item.location ? ` · ${item.location}` : ''}
                </span>
                {item.description && <p>{item.description}</p>}
              </button>
              <div className="cal-result-end">
                <span>{item.kind === 'event' ? 'Event' : 'Task'}</span>
                {item.date && (
                  <button
                    className="cal-icon-button"
                    title="Show in calendar"
                    aria-label={`Show ${item.title} in calendar`}
                    onClick={() => reveal(item)}
                  >
                    <Icon name="arrow" />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="cal-empty">
          <Icon name="search" size={28} />
          <h3>No matching {kind === 'all' ? 'items' : kind === 'event' ? 'events' : 'tasks'}</h3>
          <p>Try a different title, place, or word from your notes.</p>
        </div>
      )}
    </section>
  )
}
