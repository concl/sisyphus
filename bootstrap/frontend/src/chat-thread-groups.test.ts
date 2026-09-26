import { describe, expect, it } from 'vitest'
import { threadGroups, UNBOUND_LABEL } from '../../../plugins/chat/frontend/thread-groups'
import type { ThreadSummary } from '../../../plugins/chat/frontend/types'

function thread(
  id: string,
  folder: string | null,
  updatedAt = '2024-01-01T00:00:00.000Z',
): ThreadSummary {
  return { id, title: id, updatedAt, folder }
}

describe('sidebar thread groups', () => {
  it('groups conversations by folder and keeps the recency order', () => {
    // The list arrives newest first: `work` is newest, then `other`, then the unbound one.
    const groups = threadGroups([
      thread('a', 'C:\\work\\app'),
      thread('b', 'C:\\side\\thing'),
      thread('c', null),
      thread('d', 'C:\\work\\app'),
    ])
    expect(groups.map((group) => group.label)).toEqual(['app', 'thing', UNBOUND_LABEL])
    expect(groups.map((group) => group.threads.map((item) => item.id))).toEqual([
      ['a', 'd'],
      ['b'],
      ['c'],
    ])
    expect(groups[0].folder).toBe('C:\\work\\app')
    expect(groups[2].folder).toBeNull()
  })

  it('adds the path only when two folders share a name', () => {
    const groups = threadGroups([
      thread('a', 'C:\\work\\app'),
      thread('b', 'D:\\clones\\app'),
      thread('c', 'C:\\side\\thing'),
    ])
    // A folder whose name is unique needs no path; the two `app` folders do.
    expect(groups.map((group) => group.detail)).toEqual(['C:\\work\\app', 'D:\\clones\\app', ''])
  })

  it('treats names that differ only in case as the same name', () => {
    const groups = threadGroups([thread('a', 'C:\\work\\App'), thread('b', 'D:\\other\\app')])
    expect(groups.every((group) => group.detail !== '')).toBe(true)
  })

  it('has no groups without conversations', () => {
    expect(threadGroups([])).toEqual([])
  })
})
