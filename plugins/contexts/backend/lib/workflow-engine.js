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

function validateProgram(input, registry, { validateDefaults = true, draft = false } = {}) {
  if (!input || typeof input !== 'object') throw new Error('Invalid action')
  const id = input.id ?? randomUUID()
  if (!validId(id)) throw new Error('Invalid action id')
  const inputs = normalizeInputs(input.inputs)
  const values = valuesFor(inputs)
  if (!Array.isArray(input.nodes) || (!draft && !input.nodes.length) || input.nodes.length > 64)
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
    const bindings = normalizeBindings(node.bindings, inputs, draft ? undefined : runner)
    const drafts = jsonValue(node.drafts ?? {})
    if (
      !drafts ||
      typeof drafts !== 'object' ||
      Array.isArray(drafts) ||
      Object.entries(drafts).some(
        ([key, value]) => !/^[a-zA-Z0-9_-]{1,80}$/.test(key) || typeof value !== 'string',
      )
    )
      throw new Error('Invalid unfinished settings')
    if (!draft && Object.keys(drafts).length)
      throw new Error(
        `${node.title || node.type}: finish editing ${Object.keys(drafts).join(', ')}`,
      )
    if (runner && validateDefaults && !draft && !hasStepBindings({ bindings }))
      runner.validate({ ...runner.defaults, ...resolveConfig({ config, bindings }, values) })
    const name =
      (typeof node.title === 'string' ? node.title.trim() : (runner?.name ?? node.type)) ||
      (draft ? (runner?.name ?? node.type) : '')
    if (!name || name.length > 80) throw new Error('Give every step a title')
    return {
      id: node.id,
      type: node.type,
      title: name,
      config,
      bindings,
      ...(Object.keys(drafts).length ? { drafts } : {}),
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
  if (!draft && nodes.some((node) => !visited.has(node.id)))
    throw new Error('Connect every step to Start')
  // Disconnected drafts are valid documents, but must not conceal a cycle.
  for (const node of nodes) visit(node.id)
  const ancestors = (id, result = new Set()) => {
    for (const edge of edges.filter((edge) => edge.to === id)) {
      if (result.has(edge.from)) continue
      result.add(edge.from)
      ancestors(edge.from, result)
    }
    return result
  }
  for (const node of draft ? [] : nodes) {
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

function checkProgram(saved, registry, inputValues = {}) {
  const issues = []
  let flow, values
  try {
    flow = validateProgram(saved, registry, { draft: true })
    values = valuesFor(flow.inputs, inputValues)
  } catch (error) {
    return [{ message: error.message }]
  }
  if (!flow.nodes.length) issues.push({ message: 'Add a step to run this workflow.' })
  const reachable = new Set(['start'])
  for (let i = 0; i < flow.nodes.length; i++)
    for (const edge of flow.edges) if (reachable.has(edge.from)) reachable.add(edge.to)
  for (const input of flow.inputs)
    if (input.draft !== undefined && !Object.hasOwn(inputValues, input.key))
      issues.push({ message: `Finish editing input “${input.label}”.` })
  for (const node of flow.nodes) {
    const add = (message) => issues.push({ nodeId: node.id, message: `${node.title}: ${message}` })
    if (!reachable.has(node.id)) add('Connect this step to Start.')
    const action = registry.get(node.type)
    if (!action) {
      add(`Action unavailable: ${node.type}. Enable its plugin to run it.`)
      continue
    }
    if (Object.keys(node.drafts ?? {}).length) {
      add(
        `Finish editing ${Object.keys(node.drafts)
          .map((key) => action.fields.find((field) => field.key === key)?.label ?? key)
          .join(', ')}.`,
      )
      continue
    }
    try {
      normalizeBindings(node.bindings, flow.inputs, action)
      for (const ref of Object.values(node.bindings)) {
        if (!ref?.step) continue
        if (!flow.nodes.some((step) => step.id === ref.step))
          throw new Error('A source step was removed. Choose another value source.')
        const ancestors = new Set()
        const visit = (id) => {
          for (const edge of flow.edges.filter((edge) => edge.to === id)) {
            if (ancestors.has(edge.from)) continue
            ancestors.add(edge.from)
            visit(edge.from)
          }
        }
        visit(node.id)
        if (!ancestors.has(ref.step))
          throw new Error('A result must come from a connected earlier step')
      }
      if (!hasStepBindings(node))
        action.validate({ ...action.defaults, ...resolveConfig(node, values) })
    } catch (error) {
      add(error.message)
    }
  }
  // Validate result paths and execution dependencies without evaluating dynamic values.
  if (!issues.length) {
    try {
      validateProgram(saved, registry, { validateDefaults: false })
    } catch (error) {
      issues.push({ message: error.message })
    }
  }
  return issues
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
    const issues = checkProgram(saved, this.actions, inputValues)
    if (issues.length) throw new Error(issues.map((issue) => issue.message).join('\n'))
    const flow = validateProgram(saved, this.actions, { validateDefaults: false })
    const id = flow.id
    if (this.active.has(id)) throw new Error('This action is already running')
    const values = valuesFor(flow.inputs, inputValues)
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
          const config = { ...action.defaults, ...resolveConfig(node, run.inputValues, outputs) }
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

module.exports = { WorkflowEngine, validateProgram, checkProgram }
