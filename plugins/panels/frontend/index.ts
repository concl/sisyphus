import { services, type AppPlugin, type PanelDefinition, type Panels } from '@sisyphus/sdk'

export function createPanels(): Panels {
  let panels: PanelDefinition[] = []
  const listeners = new Set<() => void>()
  const openListeners = new Set<(id: string) => void>()
  // Contributions whose owner has just let go of them, by panel id.
  //
  // Reloading a plugin disposes its old code and mounts its new code in the same turn,
  // so its panel is withdrawn and registered again almost immediately. Dropping it out
  // of the list in between would take the block that draws it off the screen and its
  // icon out of the rail on every reload, for a gap nobody can see. The withdrawal
  // therefore waits a turn, and a registration for the same id inside that turn is a
  // replacement: the new code appears in the same place, and the block is never told
  // that anything left. A contribution that is really gone - a plugin unmounted,
  // deleted, or switched off - is dropped when the turn passes.
  const leaving = new Map<string, PanelDefinition>()
  const notify = () => listeners.forEach((listener) => listener())
  return {
    register(panel) {
      const superseded = leaving.get(panel.id)
      if (superseded) {
        leaving.delete(panel.id)
        panels = panels.filter((item) => item !== superseded)
      } else if (panels.some((item) => item.id === panel.id)) {
        throw new Error(`Duplicate panel: ${panel.id}`)
      }
      // Array#sort is stable, so equal-priority contributions keep plugin mount order.
      // This lets a plugin opt into prominent placement without coupling the registry
      // to a hard-coded list of plugin ids.
      panels = [...panels, panel].sort(
        (left, right) => (right.priority ?? 0) - (left.priority ?? 0),
      )
      notify()
      return () => {
        leaving.set(panel.id, panel)
        setTimeout(() => {
          // A replacement may have taken this id's place while the withdrawal waited,
          // and then this contribution is already out of the list.
          if (leaving.get(panel.id) !== panel) return
          leaving.delete(panel.id)
          panels = panels.filter((item) => item !== panel)
          notify()
        }, 0)
      }
    },
    list: () => panels,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    open(id) {
      if (panels.some((panel) => panel.id === id)) openListeners.forEach((listener) => listener(id))
    },
    onOpen(listener) {
      openListeners.add(listener)
      return () => {
        openListeners.delete(listener)
      }
    },
  }
}
export const panelsPlugin: AppPlugin = {
  id: 'ui.panels',
  name: 'Panel registry',
  provide: [services.panels],
  apply(ctx) {
    ctx.provide(services.panels, createPanels())
  },
}
