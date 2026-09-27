import ICAL from 'ical.js'
import type { PlannerItem } from '@sisyphus/sdk'

export const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
export const fromDay = (day: string) => new Date(`${day}T00:00:00`)
export const addDays = (day: string, count: number) => {
  const date = fromDay(day)
  date.setDate(date.getDate() + count)
  return dateKey(date)
}
export type Occurrence = {
  item: PlannerItem
  key: string
  date: string
  endDate: string
  start?: Date
  end?: Date
}

export function monthDays(month: Date) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1)
  const weeks = Math.ceil(
    (start.getDay() + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) / 7,
  )
  start.setDate(1 - start.getDay())
  return Array.from({ length: weeks * 7 }, (_, index) => addDays(dateKey(start), index))
}

export function occurrences(records: PlannerItem[], first: string, last: string) {
  const result: Occurrence[] = [],
    warnings: string[] = []
  const include = (value: Occurrence) => {
    if (value.date <= last && value.endDate > first) result.push(value)
  }
  for (const item of records) {
    if (!item.ical) {
      if (!item.date) continue
      const start = item.start ? new Date(item.start) : undefined
      const end = item.end ? new Date(item.end) : undefined
      const date = start ? dateKey(start) : item.date
      include({
        item,
        key: item.id,
        date,
        start,
        end,
        endDate: end
          ? addDays(dateKey(new Date(end.getTime() - 1)), 1)
          : item.endDate || addDays(date, 1),
      })
      continue
    }
    try {
      const root = new ICAL.Component(ICAL.parse(item.ical))
      const components = root.getAllSubcomponents(item.kind === 'event' ? 'vevent' : 'vtodo')
      const master = components.find((c) => !c.hasProperty('recurrence-id'))!
      const property = master.getFirstProperty(item.kind === 'todo' ? 'due' : 'dtstart')
      if (!property) continue
      const tzid = property.getParameter('tzid')
      if (tzid && tzid !== 'UTC' && !root.getTimeZoneByID(String(tzid))) {
        warnings.push(`${item.title}: its ${tzid} time zone definition is missing from the file.`)
        continue
      }
      const time = property.getFirstValue() as ICAL.Time
      if (item.kind === 'todo') {
        const date = time.isDate ? time.toString() : dateKey(time.toJSDate())
        include({ item, key: item.id, date, endDate: addDays(date, 1) })
        if (master.hasProperty('rrule'))
          warnings.push(
            `${item.title}: repeating task rules are preserved; only the original due date is shown.`,
          )
        continue
      }
      const event = new ICAL.Event(master, { exceptions: components.filter((c) => c !== master) })
      const iterator = event.iterator()
      let count = 0,
        next: ICAL.Time | null
      while ((next = iterator.next())) {
        if (++count > 20000) {
          warnings.push(`${item.title}: recurrence is too large to display fully.`)
          break
        }
        const details = event.getOccurrenceDetails(next)
        const start = details.startDate,
          end = details.endDate
        if (start.toString().slice(0, 10) > addDays(last, 2)) break
        if (details.item.component.getFirstPropertyValue('status') === 'CANCELLED') continue
        const date = start.isDate ? start.toString() : dateKey(start.toJSDate())
        const endDate = start.isDate
          ? end.toString()
          : addDays(
              dateKey(new Date(Math.max(start.toJSDate().getTime(), end.toJSDate().getTime() - 1))),
              1,
            )
        include({
          item: details.item.isRecurrenceException()
            ? { ...item, title: details.item.summary || item.title }
            : item,
          key: `${item.id}:${next.toString()}`,
          date,
          endDate: endDate > date ? endDate : addDays(date, 1),
          start: start.isDate ? undefined : start.toJSDate(),
          end: end.isDate ? undefined : end.toJSDate(),
        })
      }
    } catch {
      warnings.push(
        `${item.title}: this schedule cannot be displayed. Its original ICS data is still preserved.`,
      )
    }
  }
  result.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.start?.getTime() || 0) - (b.start?.getTime() || 0) ||
      a.item.title.localeCompare(b.item.title),
  )
  return { entries: result, warnings }
}

export const onDay = (entry: Occurrence, day: string) => entry.date <= day && entry.endDate > day
export const timeLabel = (entry: Occurrence) =>
  entry.start
    ? entry.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : entry.item.kind === 'todo'
      ? 'Task'
      : 'All day'
