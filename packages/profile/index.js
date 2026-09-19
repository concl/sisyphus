import { Context } from '@deepseek-ai/cordis'

/** Named composition for one process. Cordis owns all plugin lifecycle work. */
export class Profile {
  constructor() {
    this.context = new Context()
    this.entries = new Map()
    this.listeners = new Set()
    this.queue = Promise.resolve()
    this.context.on('internal/status', () => this.notify())
  }

  notify() {
    for (const listener of this.listeners) listener(this.list())
  }
  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  get(service) {
    const value = this.context.get(service)
    if (value === undefined) throw new Error(`Service unavailable: ${service}`)
    return value
  }
  list() {
    const states = ['waiting', 'starting', 'active', 'failed', 'disabled', 'stopping']
    return [...this.entries.values()].map(({ id, plugin, fiber, enabled, error }) => ({
      id,
      name: plugin.name ?? id,
      enabled,
      state: enabled ? (states[fiber?.state ?? 0] ?? 'failed') : 'disabled',
      error,
      requires: Array.isArray(plugin.inject)
        ? [...plugin.inject]
        : Object.keys(plugin.inject ?? {}),
      provides: typeof plugin.provide === 'string' ? [plugin.provide] : [...(plugin.provide ?? [])],
    }))
  }
  async mount(entries) {
    for (const { id, plugin } of entries) {
      if (this.entries.has(id)) throw new Error(`Duplicate plugin: ${id}`)
      this.entries.set(id, { id, plugin, enabled: true, fiber: null, error: undefined })
    }
    // Register all first: Cordis handles dependency order and waiting fibers.
    const fibers = []
    for (const entry of this.entries.values()) {
      entry.fiber = this.context.plugin(entry.plugin)
      fibers.push(
        entry.fiber.await().catch((error) => {
          entry.error = String(error)
        }),
      )
    }
    await Promise.all(fibers)
    this.notify()
  }
  setEnabled(id, enabled) {
    if (typeof enabled !== 'boolean') return Promise.reject(new Error('Expected enabled boolean'))
    const op = this.queue.then(async () => {
      const entry = this.entries.get(id)
      if (!entry) throw new Error(`Unknown plugin: ${id}`)
      if (entry.enabled === enabled) return
      entry.enabled = enabled
      if (enabled) {
        entry.error = undefined
        entry.fiber = this.context.plugin(entry.plugin)
        try {
          await entry.fiber.await()
        } catch (error) {
          entry.error = String(error)
        }
      } else {
        await entry.fiber?.dispose()
        entry.fiber = null
      }
      this.notify()
    })
    this.queue = op.catch(() => {})
    return op
  }
  async dispose() {
    await this.queue
    await this.context.fiber.dispose()
    this.listeners.clear()
  }
}
