'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { isDeepStrictEqual } = require('node:util')

const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id)
const copy = (value) => JSON.parse(JSON.stringify(value))

function read(file, optional = false) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Expected a JSON object')
    return value
  } catch (error) {
    if (optional && error.code === 'ENOENT') return undefined
    throw new Error(`Cannot read ${file}: ${error.message}`, { cause: error })
  }
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
    fs.renameSync(temporary, file)
  } finally {
    fs.rmSync(temporary, { force: true })
  }
}

// Programs are reusable documents; cards contain presentation and input values.
// Enumerate cards directly, rather than maintaining a second list of their data.
class AutomationFiles {
  constructor(userData) {
    this.root = path.join(userData, 'automations')
    this.legacyFile = path.join(userData, 'storage', 'automations.json')
  }
  cardFile(id) {
    if (!validId(id)) throw new Error('Invalid card id')
    return path.join(this.root, 'cards', `${id}.json`)
  }
  programFile(id) {
    if (!validId(id)) throw new Error('Invalid program id')
    return path.join(this.root, 'programs', id, 'program.json')
  }
  initialized() {
    const state = read(path.join(this.root, 'migration.json'), true)
    if (state && state.version !== 1) throw new Error('Unsupported automation migration version')
    return Boolean(state)
  }
  legacyFlows() {
    const legacy = read(this.legacyFile, true)
    const flows = legacy?.['flows.v1']
    if (flows !== undefined && !Array.isArray(flows)) throw new Error('Invalid legacy automations')
    return flows
  }
  initialize(flows) {
    if (this.initialized()) return
    // All legacy records have been validated before the first write. Interrupted
    // imports resume without replacing cards already created or edited here.
    flows.forEach((flow, index) => {
      if (!read(this.cardFile(flow.id), true)) this.save(flow, index)
    })
    write(path.join(this.root, 'migration.json'), { version: 1, source: 'flows.v1' })
  }
  cards() {
    let entries
    try {
      entries = fs.readdirSync(path.join(this.root, 'cards'), { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => {
        const id = entry.name.slice(0, -5)
        const card = read(this.cardFile(id))
        if (
          card.version !== 1 ||
          card.id !== id ||
          !validId(card.programId) ||
          !Number.isSafeInteger(card.order) ||
          !card.inputValues ||
          typeof card.inputValues !== 'object' ||
          Array.isArray(card.inputValues)
        )
          throw new Error(`Invalid automation card: ${entry.name}`)
        return card
      })
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  }
  program(id) {
    const program = read(this.programFile(id))
    if (program.version !== 1 || program.id !== id || !Array.isArray(program.inputs))
      throw new Error(`Invalid automation program: ${id}`)
    return program
  }
  list() {
    return this.cards().map((card) => {
      const program = this.program(card.programId)
      return {
        id: card.id,
        programId: card.programId,
        title: card.title,
        description: card.description,
        color: card.color,
        inputs: program.inputs.map(({ default: fallback, ...definition }) => ({
          ...definition,
          value: Object.hasOwn(card.inputValues ?? {}, definition.key)
            ? card.inputValues[definition.key]
            : fallback,
        })),
        nodes: program.nodes,
        edges: program.edges,
      }
    })
  }
  save(flow, order) {
    const cards = this.cards()
    const previous = cards.find((card) => card.id === flow.id)
    if (previous && flow.programId && flow.programId !== previous.programId)
      throw new Error('This program changed. Reopen the card before saving.')
    let programId = previous?.programId ?? flow.programId ?? flow.id
    const previousProgram = read(this.programFile(programId), true)
    if (previousProgram && (previousProgram.version !== 1 || previousProgram.id !== programId))
      throw new Error(`Invalid automation program: ${programId}`)
    if (flow.programId && !previousProgram) throw new Error('Automation program is missing')
    const graph = {
      inputs: (flow.inputs ?? []).map(({ value: _value, ...definition }) => definition),
      nodes: flow.nodes,
      edges: flow.edges,
    }
    const previousGraph = previousProgram && {
      inputs: previousProgram.inputs.map(({ default: _default, ...definition }) => definition),
      nodes: previousProgram.nodes,
      edges: previousProgram.edges,
    }
    if (!isDeepStrictEqual(graph, previousGraph)) {
      // Publish a new program before pointing the card at it. A failed card
      // write leaves the previous card/program pair intact. Graph edits never
      // change another card's program; old programs remain available on disk.
      if (previousProgram) programId = randomUUID()
      const file = this.programFile(programId)
      if (previousProgram)
        fs.cpSync(path.dirname(this.programFile(previousProgram.id)), path.dirname(file), {
          recursive: true,
          errorOnExist: true,
          force: false,
        })
      write(file, {
        version: 1,
        id: programId,
        name: flow.title,
        inputs: (flow.inputs ?? []).map(({ value, ...definition }) => ({
          ...definition,
          default: value,
        })),
        nodes: flow.nodes,
        edges: flow.edges,
      })
    }
    write(this.cardFile(flow.id), {
      version: 1,
      id: flow.id,
      programId,
      title: flow.title,
      description: flow.description,
      color: flow.color,
      order: previous?.order ?? order ?? Math.max(-1, ...cards.map((card) => card.order)) + 1,
      inputValues: Object.fromEntries((flow.inputs ?? []).map((input) => [input.key, input.value])),
    })
    return copy({ ...flow, programId })
  }
  delete(id) {
    fs.rmSync(this.cardFile(id), { force: true })
  }
  reorder(ids) {
    const cards = this.cards()
    ids.forEach((id, order) => {
      const card = cards.find((card) => card.id === id)
      if (card.order !== order) write(this.cardFile(id), { ...card, order })
    })
  }
}

module.exports = { AutomationFiles }
