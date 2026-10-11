'use strict'
// Builds a card's flow document from a compact, model-friendly description.
// Keeping graph construction here lets an agent tool create or edit an action
// without hand-writing node ids, coordinates, or connections.
const copy = (value) => JSON.parse(JSON.stringify(value))
const validStepId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id)
const firstX = 320
const gapX = 290
const firstY = 60

function defaultForKind(kind) {
  if (kind === 'number') return 0
  if (kind === 'boolean') return false
  if (kind === 'lines' || kind === 'urls') return []
  if (kind === 'json') return null
  return ''
}

function buildNode(step, index, registry) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error('Invalid step')
  const type = typeof step.action === 'string' && step.action ? step.action : step.type
  const action = registry?.get(type)
  if (!action)
    throw new Error(`Unknown action: ${type}. Use list_action_types to see available actions.`)
  const id = step.id ?? `step-${index + 1}`
  if (!validStepId(id))
    throw new Error(`Invalid step id: ${id}. Use letters, digits, dashes, and underscores.`)
  const config = step.config ?? {}
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new Error('Step settings must be an object')
  const node = {
    id,
    type: action.type,
    title: (typeof step.title === 'string' ? step.title.trim() : '') || action.name || action.type,
    // Start from the action defaults so the saved step is self-contained, then
    // let explicit settings override them.
    config: { ...copy(action.defaults ?? {}), ...copy(config) },
    x: Number.isFinite(step.x) ? step.x : firstX + index * gapX,
    y: Number.isFinite(step.y) ? step.y : firstY,
  }
  if (step.bindings && typeof step.bindings === 'object' && !Array.isArray(step.bindings))
    node.bindings = copy(step.bindings)
  return node
}

function buildNodes(steps, registry) {
  if (!Array.isArray(steps) || !steps.length) throw new Error('An action needs at least one step')
  if (steps.length > 64) throw new Error('An action supports up to 64 steps')
  const nodes = steps.map((step, index) => buildNode(step, index, registry))
  const seen = new Set()
  for (const node of nodes) {
    if (seen.has(node.id)) throw new Error(`Duplicate step id: ${node.id}`)
    seen.add(node.id)
  }
  return nodes
}

// A single ordered chain: Start runs the first step, which runs the next.
function linearEdges(nodes) {
  return nodes.map((node, index) => ({ from: index ? nodes[index - 1].id : 'start', to: node.id }))
}

function buildInputs(inputs) {
  if (inputs === undefined) return []
  if (!Array.isArray(inputs)) throw new Error('Inputs must be a list')
  return inputs.map((input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Invalid input')
    const value = input.value === undefined ? defaultForKind(input.kind) : input.value
    return { ...input, value }
  })
}

module.exports = { buildNodes, buildInputs, linearEdges, defaultForKind, validStepId }
