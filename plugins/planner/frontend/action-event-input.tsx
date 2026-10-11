import { useState } from 'react'
import type { PlannerItem } from '@sisyphus/sdk'
import type { ActionInputProps } from '@sisyphus/sdk'
import { EventScheduleFields } from './event-schedule'
import { addDays, dateKey } from './model'

export function EventInput({ value, change, disabled }: ActionInputProps) {
  const event = (value && typeof value === 'object' ? value : {}) as Partial<PlannerItem>
  const localTime = (value?: string | null) =>
    value
      ? new Date(value).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      : ''
  const [draft, setDraft] = useState(() => ({
    title: event.title ?? '',
    date: event.start ? dateKey(new Date(event.start)) : (event.date ?? ''),
    last: event.end
      ? dateKey(new Date(event.end))
      : event.endDate
        ? addDays(event.endDate, -1)
        : (event.date ?? ''),
    timed: Boolean(event.start),
    start: localTime(event.start) || '09:00',
    end: localTime(event.end) || '10:00',
    location: event.location ?? '',
    description: event.description ?? '',
  }))
  const invalid =
    !draft.title.trim() ||
    !draft.date ||
    !draft.last ||
    draft.last < draft.date ||
    (draft.timed &&
      (!draft.start ||
        !draft.end ||
        `${draft.last}T${draft.end}` <= `${draft.date}T${draft.start}`))
  function update(patch: Partial<typeof draft>) {
    const next = { ...draft, ...patch }
    setDraft(next)
    const iso = (day: string, time: string) => {
      const date = new Date(`${day}T${time}`)
      return Number.isFinite(date.getTime()) ? date.toISOString() : null
    }
    change({
      title: next.title,
      date: next.date,
      location: next.location,
      description: next.description,
      start: next.timed ? iso(next.date, next.start) : null,
      end: next.timed ? iso(next.last, next.end) : null,
      endDate: !next.timed && next.last ? addDays(next.last, 1) : null,
    })
  }
  return (
    <fieldset
      disabled={disabled}
      className="action-provider-input"
      aria-invalid={invalid}
      style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
    >
      <label>
        Title
        <input
          aria-label="Event title"
          value={draft.title}
          maxLength={500}
          required
          onChange={(event) => update({ title: event.target.value })}
        />
      </label>
      <EventScheduleFields
        type="event"
        date={draft.date}
        last={draft.last}
        timed={draft.timed}
        start={draft.start}
        end={draft.end}
        setDate={(date) =>
          update({ date, last: !draft.last || draft.last < date ? date : draft.last })
        }
        setLast={(last) => update({ last })}
        setTimed={(timed) => update({ timed })}
        setStart={(start) => update({ start })}
        setEnd={(end) => update({ end })}
      />
      <details>
        <summary>Location and notes</summary>
        <label>
          Location
          <input
            value={draft.location}
            maxLength={2000}
            onChange={(event) => update({ location: event.target.value })}
          />
        </label>
        <label>
          Notes
          <textarea
            value={draft.description}
            maxLength={20000}
            rows={3}
            onChange={(event) => update({ description: event.target.value })}
          />
        </label>
      </details>
    </fieldset>
  )
}
