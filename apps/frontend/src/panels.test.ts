import { describe, expect, it } from 'vitest'
import { createPanels } from '@sisyphus/plugin-panels'
describe('panel contributions', () => {
  it('removes contributions reversibly, rejects duplicates, and does not open missing blocks', () => {
    const registry = createPanels()
    const panel = { id: 'test', title: 'Test', icon: 'T', description: '', component: () => null }
    let changes = 0
    let opened = ''
    const off = registry.subscribe(() => {
      changes++
    })
    registry.onOpen((id) => {
      opened = id
    })
    const remove = registry.register(panel)
    expect(() => registry.register(panel)).toThrow('Duplicate')
    registry.open('test')
    expect(opened).toBe('test')
    remove()
    opened = ''
    registry.open('test')
    expect(registry.list()).toEqual([])
    expect(opened).toBe('')
    expect(changes).toBe(2)
    off()
  })
})
