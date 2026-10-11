import type { CSSProperties } from 'react'
import type { PlannerCalendar, PlannerItem } from '@sisyphus/sdk'

export const defaultCalendars: PlannerCalendar[] = [
  { id: 'default', name: 'My calendar', color: '#4285f4', updatedAt: '', actor: '' },
]
export const itemCalendar = (item: PlannerItem, calendars: PlannerCalendar[]) =>
  calendars.find((calendar) => calendar.id === (item.calendarId || 'default')) ||
  defaultCalendars[0]
export const calendarStyle = (item: PlannerItem, calendars: PlannerCalendar[]): CSSProperties =>
  ({ '--item-accent': itemCalendar(item, calendars).color }) as CSSProperties
