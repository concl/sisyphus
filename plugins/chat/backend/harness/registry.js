'use strict'
const { assertHarness } = require('./contract')

/**
 * The harnesses a chat worker can run. Built-ins are registered below; a new
 * adapter is a module that exports `{ id, name, description, run }` and one entry
 * in this list. The id is what Settings > Chat stores.
 */
class HarnessRegistry {
  constructor(harnesses = []) {
    this.entries = new Map()
    for (const harness of harnesses) this.register(harness)
  }

  /** Adds a harness and returns a disposer, so tests and plugins can scope one. */
  register(harness) {
    assertHarness(harness)
    if (this.entries.has(harness.id)) throw new Error(`Duplicate agent harness: ${harness.id}`)
    this.entries.set(harness.id, harness)
    return () => {
      if (this.entries.get(harness.id) === harness) this.entries.delete(harness.id)
    }
  }

  get(id) {
    return this.entries.get(id) ?? null
  }

  /** Metadata safe to send to the renderer: no run functions or provider keys. */
  list() {
    return [...this.entries.values()].map(({ id, name, description }) => ({
      id,
      name,
      description: description ?? '',
    }))
  }
}

/** The shipped harnesses. Keep this list explicit: the worker is bundled. */
function createHarnessRegistry() {
  return new HarnessRegistry([require('../harnesses/vercel-ai')])
}

module.exports = { HarnessRegistry, createHarnessRegistry }
