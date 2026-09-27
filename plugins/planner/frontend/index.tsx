import { Calendar } from './calendar'
import icon from './icon.svg'
import {
  services,
  type AppPlugin,
  type Desktop,
  type Planner,
  type PlannerItem,
  type PlannerSnapshot,
  type Panels,
} from '@sisyphus/sdk'

// One reactive service in this Cordis scope. Views inject the contract and never
// import each other or reach through to a concrete repository.
export const plannerPlugin: AppPlugin = {
  id: 'feature.planner',
  name: 'Calendar',
  inject: [services.desktop, services.panels],
  provide: [services.planner],
  apply(ctx) {
    const desktop = ctx.get(services.desktop) as Desktop
    let snapshot: PlannerSnapshot = { records: [], folder: null, error: '' }
    let alive = true
    let revision = 0
    const listeners = new Set<() => void>()
    const update = (patch: Partial<PlannerSnapshot>) => {
      if (!alive) return
      snapshot = { ...snapshot, ...patch }
      for (const listener of listeners) listener()
    }
    const call = async (method: string, input?: unknown) => {
      try {
        const value = await desktop.call(method, input)
        update({ error: '' })
        return value
      } catch (error) {
        update({ error: String(error) })
        throw error
      }
    }
    const planner: Planner = {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      create: (input) => call('planner.create', { kind: 'todo', ...input }),
      update: (id, changes) => call('planner.update', { id, ...changes }),
      remove: (id) => call('planner.remove', { id }),
      async chooseFolder() {
        const result = (await call('planner.sync.chooseFolder')) as { folder: string | null }
        update({ folder: result.folder })
      },
      importICS: (text) =>
        call('planner.importICS', { text }) as Promise<{ added: number; skipped: number }>,
      exportICS: () => call('planner.exportICS') as Promise<string>,
      async sync() {
        await call('planner.sync.now')
      },
    }
    ctx.provide(services.planner, planner)
    const panels = ctx.get(services.panels) as Panels
    function CalendarPanel() {
      return <Calendar planner={planner} />
    }
    ctx.effect(() =>
      panels.register({
        id: 'calendar',
        title: 'Calendar',
        icon,
        description: 'Events, tasks, and portable iCalendar files.',
        component: CalendarPanel,
      }),
    )
    ctx.effect(() =>
      desktop.on<{ records: PlannerItem[] }>('planner.changed', (document) => {
        revision++
        update({ records: document.records.filter((item) => !item.deleted) })
      }),
    )
    const initial = revision
    void desktop
      .call<{ records: PlannerItem[] }>('planner.get')
      .then((document) => {
        if (revision === initial)
          update({ records: document.records.filter((item) => !item.deleted) })
      })
      .catch((error) => update({ error: String(error) }))
    void desktop
      .call<{ folder: string | null }>('planner.sync.status')
      .then(update)
      .catch(() => {})
    ctx.effect(() => () => {
      alive = false
      listeners.clear()
    })
  },
}
