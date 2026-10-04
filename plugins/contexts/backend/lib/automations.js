'use strict'
const { WorkflowEngine, validateProgram } = require('./workflow-engine.js')
const { launcherPrograms } = require('./import-launchers.js')
const colors = ['blue', 'green', 'amber', 'purple', 'rose', 'slate']
const { valuesFor } = require('./action-inputs.js')

function validateFlow(input, registry) {
  const program = validateProgram(input, registry)
  const title = typeof input.title === 'string' ? input.title.trim() : ''
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
    const flow = validateFlow(input, this.actions)
    this.list()
    return this.files.save(flow)
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
  setInputs(id, inputValues) {
    const saved = this.list().find((flow) => flow.id === id)
    if (!saved) throw new Error('Action not found')
    const values = valuesFor(saved.inputs ?? [], inputValues)
    return this.save({
      ...saved,
      inputs: (saved.inputs ?? []).map((input) => ({ ...input, value: values[input.key] })),
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
