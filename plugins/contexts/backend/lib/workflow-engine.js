'use strict'
const { randomUUID } = require('node:crypto')
const { ActionServices, validActionId } = require('./action-services.js')
const {
  normalizeInputs,
  valuesFor,
  normalizeBindings,
  resolveConfig,
  hasStepBindings,
  jsonValue,
  compatible,
} = require('./action-inputs.js')
const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id)
const copy = (value) => JSON.parse(JSON.stringify(value))

function validateProgram(input, registry, { validateDefaults = true } = {}) {
  if (!input || typeof input !== 'object') throw new Error('Invalid action')
  const id = input.id ?? randomUUID()
  if (!validId(id)) throw new Error('Invalid action id')
  const inputs = normalizeInputs(input.inputs)
  const values = valuesFor(inputs)
  if (!Array.isArray(input.nodes) || !input.nodes.length || input.nodes.length > 64)
    throw new Error('Add between 1 and 64 steps')
  const ids = new Set(['start'])
  const nodes = input.nodes.map((node) => {
    if (!node || !validId(node.id) || ids.has(node.id)) throw new Error('Step ids must be unique')
    ids.add(node.id)
    if (!validActionId(node.type)) throw new Error('Invalid step type')
    const runner = registry?.get(node.type)
    const config = jsonValue(node.config ?? {})
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new Error('Step settings must be an object')
    const bindings = normalizeBindings(node.bindings, inputs, runner)
    if (runner && validateDefaults && !hasStepBindings({ bindings }))
      runner.validate(resolveConfig({ config, bindings }, values))
    const name = typeof node.title === 'string' ? node.title.trim() : (runner?.name ?? node.type)
    if (!name || name.length > 80) throw new Error('Give every step a title')
    return {
      id: node.id,
      type: node.type,
      title: name,
      config,
      bindings,
      x: Math.max(0, Math.min(8000, Number(node.x) || 0)),
      y: Math.max(0, Math.min(8000, Number(node.y) || 0)),
    }
  })
  if (!Array.isArray(input.edges) || input.edges.length > 256)
    throw new Error('Invalid connections')
  const pairs = new Set()
  const edges = input.edges.map((edge) => {
    if (
      !edge ||
      !ids.has(edge.from) ||
      !ids.has(edge.to) ||
      edge.to === 'start' ||
      edge.from === edge.to
    )
      throw new Error('Connect two different steps; Start only has an output')
    const key = `${edge.from}:${edge.to}`
    if (pairs.has(key)) throw new Error('These steps are already connected')
    pairs.add(key)
    return { from: edge.from, to: edge.to }
  })
  const visited = new Set()
  const visiting = new Set()
  function visit(id) {
    if (visiting.has(id)) throw new Error('Connections cannot form a loop')
    if (visited.has(id)) return
    visiting.add(id)
    for (const edge of edges.filter((item) => item.from === id)) visit(edge.to)
    visiting.delete(id)
    visited.add(id)
  }
  visit('start')
  if (nodes.some((node) => !visited.has(node.id))) throw new Error('Connect every step to Start')
  const ancestors = (id, result = new Set()) => {
    for (const edge of edges.filter((edge) => edge.to === id)) {
      if (result.has(edge.from)) continue
      result.add(edge.from)
      ancestors(edge.from, result)
    }
    return result
  }
  for (const node of nodes) {
    for (const [field, ref] of Object.entries(node.bindings)) {
      if (!ref?.step) continue
      if (!ancestors(node.id).has(ref.step))
        throw new Error('A result must come from a connected earlier step')
      const producer = nodes.find((item) => item.id === ref.step)
      const outputs = registry?.get(producer.type)?.outputs ?? []
      const output = outputs.find((item) => item.key === ref.path?.[0])
      if (outputs.length && ref.path?.length && !output) throw new Error('Step output unavailable')
      const target = registry?.get(node.type)?.fields?.find((item) => item.key === field)
      if (output && target && ref.path.length === 1 && !compatible(target.kind, output.kind))
        throw new Error(`Output “${output.label}” cannot be used for ${target.label}`)
    }
  }
  return {
    id,
    inputs,
    nodes,
    edges,
  }
}

class WorkflowEngine {
  constructor({ actions = new ActionServices(), onRun = () => {} } = {}) {
    this.actions = actions
    this.onRun = onRun
    this.runs = new Map()
    this.active = new Map()
    this.completions = new Map()
  }
  register(type, action) {
    return this.actions.register(type, action)
  }
  types() {
    return this.actions.list()
  }
  snapshot() {
    return [...this.runs.values()].map(copy)
  }
  cancel(id) {
    this.active.get(id)?.abort()
  }
  dispose() {
    for (const controller of this.active.values()) controller.abort()
  }
  run(saved, inputValues = {}) {
    const flow = validateProgram(saved, this.actions, { validateDefaults: false })
    const id = flow.id
    if (this.active.has(id)) throw new Error('This action is already running')
    const values = valuesFor(flow.inputs, inputValues)
    for (const node of flow.nodes)
      if (!this.actions.has(node.type)) throw new Error(`Step type unavailable: ${node.type}`)
      else if (!hasStepBindings(node))
        this.actions.get(node.type).validate(resolveConfig(node, values))
    const controller = new AbortController()
    this.active.set(id, controller)
    const run = {
      id,
      runId: randomUUID(),
      status: 'running',
      startedAt: Date.now(),
      inputValues: values,
      nodes: Object.fromEntries(
        flow.nodes.map((node) => [node.id, { title: node.title, status: 'pending', output: '' }]),
      ),
    }
    this.runs.set(id, run)
    const publish = () => this.onRun(copy(run))
    publish()
    // The start request returns immediately; progress survives panel navigation.
    const actions = new Map(flow.nodes.map((node) => [node.id, this.actions.get(node.type)]))
    const completed = this.execute(flow, run, controller.signal, publish, actions).finally(() => {
      this.active.delete(id)
      this.completions.delete(id)
    })
    this.completions.set(id, completed)
    return copy(run)
  }
  async execute(flow, run, signal, publish, actions) {
    const promises = new Map([['start', Promise.resolve(true)]])
    const outputs = new Map()
    const executeNode = (id) => {
      if (promises.has(id)) return promises.get(id)
      const node = flow.nodes.find((item) => item.id === id)
      const state = run.nodes[id]
      const dependencies = flow.edges
        .filter((edge) => edge.to === id)
        .map((edge) => executeNode(edge.from))
      const promise = (async () => {
        const results = await Promise.all(dependencies)
        if (signal.aborted || results.some((success) => !success)) {
          state.status = signal.aborted ? 'cancelled' : 'skipped'
          publish()
          return false
        }
        state.status = 'running'
        publish()
        try {
          const action = actions.get(node.id)
          const config = resolveConfig(node, run.inputValues, outputs)
          action.validate(config)
          const result = await action.execute(config, {
            signal,
            flow,
            node,
            log: (chunk) => {
              state.output = (state.output + String(chunk)).slice(-32000)
              publish()
            },
          })
          state.result = result === undefined ? null : jsonValue(result)
          outputs.set(node.id, state.result)
          state.status = signal.aborted ? 'cancelled' : 'succeeded'
          publish()
          return !signal.aborted
        } catch (error) {
          state.status = signal.aborted || error.name === 'AbortError' ? 'cancelled' : 'failed'
          state.error = String(error.message ?? error)
          publish()
          return false
        }
      })()
      promises.set(id, promise)
      return promise
    }
    await Promise.all(flow.nodes.map((node) => executeNode(node.id)))
    run.status =
      signal.aborted || Object.values(run.nodes).some((node) => node.status === 'cancelled')
        ? 'cancelled'
        : Object.values(run.nodes).some((node) => node.status === 'failed')
          ? 'failed'
          : 'succeeded'
    run.finishedAt = Date.now()
    publish()
  }
}

module.exports = { WorkflowEngine, validateProgram }
