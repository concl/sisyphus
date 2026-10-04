'use strict'
const copy = (value) => JSON.parse(JSON.stringify(value))
const { jsonValue } = require('./json-data.js')
const validActionId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_.-]{1,120}$/.test(id)

class ActionServices {
  constructor() {
    this.actions = new Map()
    this.aliases = new Map()
    this.listeners = new Set()
    this.disposers = new Set()
  }
  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  changed() {
    for (const listener of this.listeners) listener(this.list())
  }
  register(id, action) {
    if (!validActionId(id) || this.has(id)) throw new Error(`Invalid or duplicate action: ${id}`)
    if (!action || typeof action.execute !== 'function') throw new Error('An action needs execute')
    const aliases = action.aliases ?? []
    if (
      !Array.isArray(aliases) ||
      new Set(aliases).size !== aliases.length ||
      aliases.some((alias) => !validActionId(alias) || alias === id || this.has(alias))
    )
      throw new Error('Invalid or duplicate action alias')
    const entry = {
      ...action,
      type: id,
      name: action.name ?? id,
      description: action.description ?? '',
      fields: action.fields ?? [],
      outputs: action.outputs ?? [],
      defaults: copy(action.defaults ?? {}),
      validate: action.validate ?? (() => {}),
      aliases,
    }
    const owner = new AbortController()
    // A registration owns its calls, including implementations retained by a run.
    entry.execute = async (input, context = {}) => {
      const signal = context.signal ? AbortSignal.any([owner.signal, context.signal]) : owner.signal
      signal.throwIfAborted()
      let abort
      const cancelled = new Promise((_, reject) => {
        abort = () => reject(signal.reason)
        signal.addEventListener('abort', abort, { once: true })
      })
      try {
        return await Promise.race([
          Promise.resolve().then(() => {
            signal.throwIfAborted()
            return action.execute(input, {
              ...context,
              signal,
              log: (value) => {
                if (!signal.aborted) context.log?.(value)
              },
            })
          }),
          cancelled,
        ])
      } finally {
        signal.removeEventListener('abort', abort)
      }
    }
    this.actions.set(id, entry)
    aliases.forEach((alias) => this.aliases.set(alias, id))
    this.changed()
    const dispose = () => {
      if (this.actions.get(id) !== entry) return
      owner.abort(new DOMException(`Action provider unavailable: ${id}`, 'AbortError'))
      this.actions.delete(id)
      aliases.forEach((alias) => this.aliases.delete(alias))
      this.disposers.delete(dispose)
      this.changed()
    }
    this.disposers.add(dispose)
    return dispose
  }
  registerService(id, { name = id, actions }) {
    if (!validActionId(id) || !actions || typeof actions !== 'object' || Array.isArray(actions))
      throw new Error('Invalid action service')
    const dispose = []
    try {
      for (const [key, action] of Object.entries(actions))
        dispose.push(this.register(`${id}.${key}`, { ...action, service: { id, name } }))
    } catch (error) {
      dispose.reverse().forEach((off) => off())
      throw error
    }
    return () => dispose.reverse().forEach((off) => off())
  }
  get(id) {
    return this.actions.get(this.aliases.get(id) ?? id)
  }
  has(id) {
    return Boolean(this.get(id))
  }
  dispose() {
    for (const dispose of [...this.disposers]) dispose()
    this.listeners.clear()
  }
  async invoke(id, input = {}, context = {}) {
    const action = this.get(id)
    if (!action) throw new Error(`Action unavailable: ${id}`)
    const config = { ...action.defaults, ...jsonValue(input) }
    action.validate(config)
    const result = await action.execute(config, {
      signal: new AbortController().signal,
      log() {},
      ...context,
    })
    return result === undefined ? null : jsonValue(result)
  }
  list() {
    return [...this.actions.values()]
      .map(({ execute: _execute, validate: _validate, ...entry }) => copy(entry))
      .sort(
        (a, b) =>
          (a.service?.name ?? '').localeCompare(b.service?.name ?? '') ||
          a.name.localeCompare(b.name),
      )
  }
}

module.exports = { ActionServices, validActionId }
