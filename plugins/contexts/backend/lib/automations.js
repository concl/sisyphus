'use strict'
const { WorkflowEngine, validateProgram } = require('./workflow-engine.js')
const { launcherPrograms } = require('./import-launchers.js')
const { buildNodes, buildInputs, linearEdges } = require('./action-drafts.js')
const colors = ['blue', 'green', 'amber', 'purple', 'rose', 'slate']
const { valuesFor } = require('./action-inputs.js')

function validateFlow(input, registry, options) {
  const program = validateProgram(input, registry, options)
  const title =
    (typeof input.title === 'string' ? input.title.trim() : '') ||
    (options?.draft ? 'Untitled workflow' : '')
  if (!title || title.length > 80) throw new Error('Give this action a title of 1–80 characters')
  if (input.programId !== undefined && !/^[a-zA-Z0-9_-]{1,80}$/.test(input.programId))
    throw new Error('Invalid program id')
  return {
    ...program,
    ...(input.programId ? { programId: input.programId } : {}),
    title,
    description: String(input.description ?? '').slice(0, 240),
    color: colors.includes(input.color) ? input.color : 'blue',
  }
}

class Automations extends WorkflowEngine {
  constructor({ files, legacy, importLegacy = () => [], actions, onRun = () => {} }) {
    super({ actions, onRun })
    this.files = files
    this.importLegacy = legacy ? () => launcherPrograms(legacy.list()) : importLegacy
  }
  list() {
    if (this.files.initialized()) return this.files.list()
    const stored = this.files.legacyFlows()
    // Import once, preserving the original launcher data for compatibility.
    const flows = stored ?? this.importLegacy()
    this.files.initialize(flows.map((flow) => validateFlow(flow)))
    return this.files.list()
  }
  save(input) {
    const flow = validateFlow(input, this.actions, { draft: true })
    this.list()
    return this.files.save(flow)
  }
  get(id) {
    const flow = this.list().find((item) => item.id === id)
    if (!flow) throw new Error('Action not found')
    return flow
  }
  // Creates a card from an ordered list of steps. The agent tools use this so a
  // caller does not have to build node ids, positions, or connections by hand.
  create(input) {
    const nodes = buildNodes(input.steps, this.actions)
    return this.save({
      ...(input.id ? { id: input.id } : {}),
      title: input.title,
      description: input.description,
      color: input.color,
      inputs: buildInputs(input.inputs),
      nodes,
      edges: input.edges ?? linearEdges(nodes),
    })
  }
  // Edits a card in place. Steps replace the graph; inputValues change only the
  // saved values, so a caller can adjust one field without rebuilding the flow.
  update(input) {
    const current = this.get(input.id)
    const nodes = input.steps ? buildNodes(input.steps, this.actions) : current.nodes
    let inputs = input.inputs ? buildInputs(input.inputs) : (current.inputs ?? [])
    if (input.inputValues) {
      const values = valuesFor(inputs, input.inputValues)
      inputs = inputs.map((entry) => {
        if (!Object.hasOwn(input.inputValues, entry.key)) return entry
        const { draft: _draft, ...rest } = entry
        return { ...rest, value: values[entry.key] }
      })
    }
    return this.save({
      id: current.id,
      programId: current.programId,
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      color: input.color ?? current.color,
      inputs,
      nodes,
      edges: input.edges ?? (input.steps ? linearEdges(nodes) : current.edges),
    })
  }
  delete(id) {
    if (this.active.has(id)) throw new Error('Stop this action before deleting it')
    this.list()
    this.files.delete(id)
    this.runs.delete(id)
  }
  reorder(ids) {
    const current = this.list()
    if (
      !Array.isArray(ids) ||
      ids.length !== current.length ||
      new Set(ids).size !== current.length ||
      ids.some((id) => !current.some((flow) => flow.id === id))
    )
      throw new Error('Invalid card order')
    this.files.reorder(ids)
  }

  start(id, inputValues = {}) {
    const saved = this.list().find((flow) => flow.id === id)
    if (!saved) throw new Error('Action not found')
    return this.run(saved, inputValues)
  }
  async runCard(id, inputValues = {}, { signal } = {}) {
    signal?.throwIfAborted()
    const run = this.start(id, inputValues)
    const cancel = () => this.cancel(id)
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
    try {
      await this.completions.get(id)
      const result = this.runs.get(id)
      if (result.status !== 'succeeded') {
        const error = new Error(`Card ${result.status}: ${id}`)
        if (result.status === 'cancelled') error.name = 'AbortError'
        throw error
      }
      return JSON.parse(JSON.stringify(result))
    } finally {
      signal?.removeEventListener('abort', cancel)
      if (signal?.aborted) this.cancel(run.id)
    }
  }
  setInputs(id, inputValues, drafts = {}) {
    const saved = this.list().find((flow) => flow.id === id)
    if (!saved) throw new Error('Action not found')
    const values = valuesFor(saved.inputs ?? [], inputValues)
    if (
      !drafts ||
      typeof drafts !== 'object' ||
      Array.isArray(drafts) ||
      Object.entries(drafts).some(
        ([key, value]) =>
          !saved.inputs.some((input) => input.key === key) || typeof value !== 'string',
      )
    )
      throw new Error('Invalid unfinished inputs')
    return this.save({
      ...saved,
      inputs: (saved.inputs ?? []).map((input) => ({
        ...input,
        value: values[input.key],
        draft: drafts[input.key],
      })),
    })
  }
  runProgram(id, inputValues = {}) {
    const saved = this.files.program(id)
    return this.run(
      {
        ...saved,
        inputs: saved.inputs.map(({ default: value, ...input }) => ({ ...input, value })),
      },
      inputValues,
    )
  }
}
module.exports = { Automations, validateFlow, colors }
