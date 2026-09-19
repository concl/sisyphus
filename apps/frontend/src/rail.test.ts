import { describe, expect, it } from 'vitest'
import { createPanels } from '@sisyphus/plugin-panels'
import {
  dropPanel,
  movePanel,
  orderedPanels,
  readRailOrder,
  readSavedLayout,
  rememberArrangement,
} from '@sisyphus/plugin-workspace/layout'

/** One contribution, the way a plugin's apply() makes it. */
const panel = (id: string, priority?: number) => ({
  id,
  title: id,
  icon: id,
  description: '',
  component: () => null,
  priority,
})

describe('the rail arrangement', () => {
  it("stands in the registry's order until the person arranges it", () => {
    const registry = createPanels()
    registry.register(panel('chat'))
    // Settings is special only in what it asks for: a priority high enough to lead the
    // rail. Nothing about it is pinned, so the arrangement below can still move it.
    registry.register(panel('settings', 100))
    registry.register(panel('todo'))
    expect(orderedPanels(registry.list(), []).map((item) => item.id)).toEqual([
      'settings',
      'chat',
      'todo',
    ])
  })

  it('is the order the person made, with the rest left in the registry order', () => {
    const panels = [panel('settings'), panel('chat'), panel('todo')]
    // Settings was dragged down; nothing else was touched.
    expect(orderedPanels(panels, ['chat', 'settings']).map((item) => item.id)).toEqual([
      'chat',
      'settings',
      'todo',
    ])
  })

  it('passes over a block that is not on the rail now, and keeps its place', () => {
    const ids = (panels: { id: string }[], arrangement: string[]) =>
      orderedPanels(panels, arrangement).map((item) => item.id)
    // Settings is switched off at the moment: the rail shows the other two.
    expect(ids([panel('chat'), panel('todo')], ['settings', 'chat', 'todo'])).toEqual([
      'chat',
      'todo',
    ])
    // Switch it back on and it is where the arrangement put it.
    expect(
      ids([panel('settings'), panel('chat'), panel('todo')], ['settings', 'chat', 'todo']),
    ).toEqual(['settings', 'chat', 'todo'])
  })

  it('ignores an id it has already placed', () => {
    const panels = [panel('chat'), panel('todo')]
    expect(orderedPanels(panels, ['todo', 'todo', 'chat']).map((item) => item.id)).toEqual([
      'todo',
      'chat',
    ])
  })

  it('moves one block into the place of another and leaves the rest alone', () => {
    expect(movePanel(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(movePanel(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(movePanel(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
    expect(movePanel(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
    expect(movePanel(['a', 'b'], -1, 0)).toEqual(['a', 'b'])
  })

  it('drops a block into a gap, counting the gap it came out of', () => {
    // The gaps in [a, b, c] are before a (0), between the icons (1, 2) and after c (3).
    expect(dropPanel(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'a', 'c'])
    expect(dropPanel(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b'])
    expect(dropPanel(['a', 'b', 'c'], 0, 3)).toEqual(['b', 'c', 'a'])
    expect(dropPanel(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
    expect(dropPanel(['a', 'b', 'c'], 3, 3)).toEqual(['a', 'b', 'c'])
  })

  it('keeps a place for a block that is off the rail while the rest is arranged', () => {
    // Settings is off, so the rail shows home and chat. Moving chat above home must not
    // take settings out of the arrangement it was placed in.
    expect(rememberArrangement(['chat', 'home'], ['settings', 'chat', 'home'])).toEqual([
      'chat',
      'home',
      'settings',
    ])
  })

  it('reads back only the panel ids a stored arrangement holds', () => {
    expect(readRailOrder(['chat', 2, null])).toEqual(['chat'])
    expect(readRailOrder(undefined)).toEqual([])
    expect(readRailOrder('chat')).toEqual([])
  })

  it('opens a layout saved with a rail order, and one saved without one', () => {
    const layout = { grid: {}, panels: {} }
    expect(readSavedLayout({ layout, rail: ['chat'] })).toEqual({ layout, rail: ['chat'] })
    // A layout saved before the rail was part of a layout leaves the rail as it is,
    // which is what a null says; an empty list is an arrangement the person made.
    expect(readSavedLayout(layout)).toEqual({ layout, rail: null })
    expect(readSavedLayout({ layout, rail: [] })).toEqual({ layout, rail: [] })
  })
})
