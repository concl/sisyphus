import { describe, it, expect } from 'vitest'
import type { PlannerItem } from '@sisyphus/sdk'
import { monthDays, occurrences, onDay } from '../../../plugins/planner/frontend/model'

const item: PlannerItem = {
  id: 'test',
  kind: 'event',
  title: 'Test',
  actor: 'test',
  updatedAt: '2026-09-01T00:00:00Z',
}
describe('calendar projection', () => {
  it('uses only the weeks belonging to the selected month', () => {
    const days = monthDays(new Date(2026, 8, 1))
    expect(days.length).toBe(35)
    expect(days[0]).toBe('2026-08-30')
    expect(days[34]).toBe('2026-10-03')
    expect(monthDays(new Date(2026, 7, 1))).toHaveLength(42)
    expect(monthDays(new Date(2026, 1, 1))).toHaveLength(28)
  })
  it('excludes the last day of all-day spans', () => {
    const entry = occurrences(
      [{ ...item, date: '2026-09-26', endDate: '2026-09-28' }],
      '2026-09-01',
      '2026-09-30',
    ).entries[0]
    expect(onDay(entry, '2026-09-26')).toBe(true)
    expect(onDay(entry, '2026-09-27')).toBe(true)
    expect(onDay(entry, '2026-09-28')).toBe(false)
  })
  it('expands recurring series, excludes EXDATE and applies moved exceptions', () => {
    const ical = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:weekly\r\nDTSTART;VALUE=DATE:20260901\r\nDTEND;VALUE=DATE:20260902\r\nSUMMARY:Weekly\r\nRRULE:FREQ=WEEKLY;COUNT=4\r\nEXDATE;VALUE=DATE:20260908\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:weekly\r\nRECURRENCE-ID;VALUE=DATE:20260915\r\nDTSTART;VALUE=DATE:20260916\r\nDTEND;VALUE=DATE:20260917\r\nSUMMARY:Moved\r\nEND:VEVENT\r\nEND:VCALENDAR`
    const result = occurrences([{ ...item, ical }], '2026-09-01', '2026-09-30')
    expect(result.warnings).toEqual([])
    expect(result.entries.map((e) => e.date)).toEqual(['2026-09-01', '2026-09-16', '2026-09-22'])
    expect(result.entries[1].item.title).toBe('Moved')
  })
  it('reports missing timezone data instead of showing an incorrect time', () => {
    const ical =
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:zone\r\nDTSTART;TZID=Missing/Zone:20260926T090000\r\nSUMMARY:Time\r\nEND:VEVENT\r\nEND:VCALENDAR'
    const result = occurrences([{ ...item, ical }], '2026-09-01', '2026-09-30')
    expect(result.entries).toHaveLength(0)
    expect(result.warnings[0]).toContain('missing')
  })
})
