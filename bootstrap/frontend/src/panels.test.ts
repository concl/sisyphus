import { describe, expect, it } from 'vitest'
import { Profile } from '@sisyphus/profile'
import { createPanels } from '@sisyphus/plugin-panels'

/** Waits for the turn a withdrawal is held for, which is what a reload fits inside. */
const turn = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('panel contributions', () => {
  it('lets a plugin take its panel back in the same turn, so a reload does not remove it', async () => {
    const registry = createPanels()
    const panel = (component = () => null) => ({
      id: 'chat',
      title: 'Chat',
      icon: 'C',
      description: '',
      component,
    })
    const remove = registry.register(panel())
    let changes = 0
    registry.subscribe(() => {
      changes++
    })

    // A reload: the old code is disposed, and the new code registers straight after.
    remove()
    const replacement = panel()
    registry.register(replacement)
    await turn()

    expect(registry.list().map((item) => item.id)).toEqual(['chat'])
    expect(registry.list()[0]).toBe(replacement)
    expect(changes, 'the block is never told its panel left').toBe(1)
  })

  it('survives the dispose-and-remount that a real reload performs', async () => {
    // The profile the window runs, with a plugin that contributes a panel through the
    // same effect a feature uses: this is the swap a reload performs, and what matters
    // is whether the registration lands before the withdrawal is allowed to stand.
    const registry = createPanels()
    const runtime = new Profile()
    const contributed = (title: string) => ({
      apply(ctx: { effect: (work: () => () => void) => void }) {
        ctx.effect(() =>
          registry.register({ id: 'chat', title, icon: 'C', description: '', component: () => null }),
        )
      },
    })
    await runtime.add({ id: 'feature.chat', plugin: contributed('First') })
    expect(registry.list().map((panel) => panel.title)).toEqual(['First'])

    let left = 0
    registry.subscribe(() => {
      if (!registry.list().some((panel) => panel.id === 'chat')) left++
    })
    await runtime.replace('feature.chat', contributed('Second'))
    expect(registry.list().map((panel) => panel.title)).toEqual(['Second'])

    await turn()
    expect(left, 'the block was never told its panel left').toBe(0)
    await runtime.dispose()
  })

  it('removes contributions reversibly, rejects duplicates, and does not open missing blocks', async () => {
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
    // Nothing takes this id back, so the withdrawal stands once the turn passes.
    remove()
    await turn()
    opened = ''
    registry.open('test')
    expect(registry.list()).toEqual([])
    expect(opened).toBe('')
    expect(changes).toBe(2)
    off()
  })

  it('orders high-priority contributions first and preserves registration order for ties', () => {
    const registry = createPanels()
    const panel = (id: string, priority?: number) => ({
      id,
      title: id,
      icon: id,
      description: '',
      component: () => null,
      priority,
    })

    registry.register(panel('first'))
    registry.register(panel('priority', 100))
    registry.register(panel('second'))
    registry.register(panel('lower', -1))

    expect(registry.list().map(({ id }) => id)).toEqual(['priority', 'first', 'second', 'lower'])
  })
})
