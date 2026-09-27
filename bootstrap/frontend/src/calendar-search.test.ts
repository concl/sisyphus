import { describe, it, expect } from 'vitest'
import type { PlannerItem } from '@sisyphus/sdk'
import { searchRecords } from '../../../plugins/planner/frontend/search'

const item = (id: string, fields: Partial<PlannerItem>): PlannerItem => ({
  id,
  kind: 'event',
  title: 'Event',
  updatedAt: '2026-01-01T00:00:00Z',
  actor: 'test',
  ...fields,
})
describe('calendar search', () => {
  const records = [
    item('past', { title: 'Design review', date: '2020-01-01', location: 'Café studio' }),
    item('future', {
      title: 'Quarterly planning',
      date: '2028-10-18',
      description: 'Review design milestones',
    }),
    item('task', { kind: 'todo', title: 'Prepare review', list: 'Design', done: true }),
    item('gone', { title: 'Design review', deleted: true }),
  ]
  it('finds past, future, completed and undated records independent of calendar filters', () => {
    expect(searchRecords(records, 'design review').map((i) => i.id)).toEqual([
      'past',
      'future',
      'task',
    ])
  })
  it('matches words across fields, accent-insensitively, and ignores excess whitespace', () => {
    expect(searchRecords(records, '  CAFE   DESIGN  ').map((i) => i.id)).toEqual(['past'])
  })
  it('does not return everything for an empty query and excludes deleted records', () => {
    expect(searchRecords(records, '  ')).toEqual([])
    expect(searchRecords(records, 'missing')).toEqual([])
    expect(searchRecords(records, 'review').some((i) => i.id === 'gone')).toBe(false)
  })
})
