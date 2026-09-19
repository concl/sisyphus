import { services, type AppPlugin, type PanelDefinition, type Panels } from '@sisyphus/sdk'

export function createPanels(): Panels {
  let panels: PanelDefinition[] = []
  const listeners = new Set<() => void>()
  const openListeners = new Set<(id: string) => void>()
  const notify = () => listeners.forEach((listener) => listener())
  return {
    register(panel) {
      if (panels.some((item) => item.id === panel.id))
        throw new Error(`Duplicate panel: ${panel.id}`)
      // Array#sort is stable, so equal-priority contributions keep plugin mount order.
      // This lets a plugin opt into prominent placement without coupling the registry
      // to a hard-coded list of plugin ids.
      panels = [...panels, panel].sort(
        (left, right) => (right.priority ?? 0) - (left.priority ?? 0),
      )
      notify()
      return () => {
        panels = panels.filter((item) => item !== panel)
        notify()
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
