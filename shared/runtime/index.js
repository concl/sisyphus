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

  /** Lifecycle work runs one step at a time, so a reload cannot interleave with a toggle. */
  enqueue(work) {
    const op = this.queue.then(work)
    this.queue = op.catch(() => {})
    return op
  }

  /** Registers one plugin with Cordis, remembering a failed mount instead of throwing. */
  async register(entry) {
    entry.error = undefined
    entry.fiber = this.context.plugin(entry.plugin)
    try {
      await entry.fiber.await()
    } catch (error) {
      entry.error = String(error)
    }
  }

  /**
   * Mounts a composition. An id that is already mounted is left alone, so a
   * profile can be composed again once a plugin has been added, removed, or
   * reloaded; the same id twice in one call is still a mistake.
   */
  async mount(entries) {
    const pending = []
    const seen = new Set()
    for (const { id, plugin } of entries) {
      if (seen.has(id)) throw new Error(`Duplicate plugin: ${id}`)
      seen.add(id)
      if (this.entries.has(id)) continue
      const entry = { id, plugin, enabled: true, fiber: null, error: undefined }
      this.entries.set(id, entry)
      pending.push(entry)
    }
    await Promise.all(pending.map((entry) => this.register(entry)))
    this.notify()
  }

  /** Mounts a plugin that arrived while the app was running, such as a new file. */
  add({ id, plugin }) {
    return this.enqueue(async () => {
      if (this.entries.has(id)) throw new Error(`Duplicate plugin: ${id}`)
      const entry = { id, plugin, enabled: true, fiber: null, error: undefined }
      this.entries.set(id, entry)
      await this.register(entry)
      this.notify()
    })
  }

  /** Disposes a plugin and forgets it, so it leaves the composition for good. */
  unmount(id) {
    return this.enqueue(async () => {
      const entry = this.entries.get(id)
      if (!entry) throw new Error(`Unknown plugin: ${id}`)
      this.entries.delete(id)
      await entry.fiber?.dispose()
      this.notify()
    })
  }

  /** Swaps a mounted plugin for new code, keeping its position and enabled switch. */
  replace(id, plugin) {
    return this.enqueue(async () => {
      const entry = this.entries.get(id)
      if (!entry) throw new Error(`Unknown plugin: ${id}`)
      const previous = entry.plugin
      await entry.fiber?.dispose()
      entry.plugin = plugin
      entry.fiber = null
      try {
        if (entry.enabled) await this.register(entry)
        if (entry.error) throw new Error(entry.error)
      } catch (error) {
        await entry.fiber?.dispose()
        entry.plugin = previous
        if (entry.enabled) await this.register(entry)
        this.notify()
        throw error
      }
      this.notify()
    })
  }

  setEnabled(id, enabled) {
    if (typeof enabled !== 'boolean') return Promise.reject(new Error('Expected enabled boolean'))
    return this.enqueue(async () => {
      const entry = this.entries.get(id)
      if (!entry) throw new Error(`Unknown plugin: ${id}`)
      if (entry.enabled === enabled) return
      entry.enabled = enabled
      if (enabled) {
        await this.register(entry)
      } else {
        await entry.fiber?.dispose()
        entry.fiber = null
      }
      this.notify()
    })
  }

  async dispose() {
    await this.queue
    await this.context.fiber.dispose()
    this.listeners.clear()
  }
}
