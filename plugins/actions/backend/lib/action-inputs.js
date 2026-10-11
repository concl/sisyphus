'use strict'
const copy = (value) => JSON.parse(JSON.stringify(value))
const reserved = new Set(['__proto__', 'constructor', 'prototype'])
const validKey = (key) =>
  typeof key === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(key) && !reserved.has(key)
const inputKinds = ['text', 'number', 'boolean', 'lines', 'urls', 'json']

const { jsonValue } = require('./json-data.js')

function inputValue(definition, value) {
  const problem = () => {
    throw new Error(`Invalid value for input “${definition.label}”`)
  }
  if (definition.kind === 'json') return jsonValue(value)
  if (definition.kind === 'text') {
    if (typeof value !== 'string' || value.length > 4096 || value.includes('\0')) problem()
  } else if (definition.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) problem()
  } else if (definition.kind === 'boolean') {
    if (typeof value !== 'boolean') problem()
  } else {
    if (
      !Array.isArray(value) ||
      value.length > 64 ||
      value.some((item) => typeof item !== 'string' || item.length > 4096 || item.includes('\0'))
    )
      problem()
  }
  return copy(value)
}

function normalizeInputs(inputs = []) {
  if (!Array.isArray(inputs) || inputs.length > 32)
    throw new Error('An action supports up to 32 inputs')
  const seen = new Set()
  return inputs.map((input) => {
    if (!input || !validKey(input.key) || seen.has(input.key))
      throw new Error('Input names must be unique')
    seen.add(input.key)
    const label = typeof input.label === 'string' ? input.label.trim() : ''
    if (!label || label.length > 80) throw new Error('Give every input a label of 1–80 characters')
    if (!inputKinds.includes(input.kind)) throw new Error(`Unknown input type: ${input.kind}`)
    const definition = { key: input.key, label, kind: input.kind === 'urls' ? 'lines' : input.kind }
    if (input.field !== undefined) {
      const field = jsonValue(input.field)
      if (
        !field ||
        Array.isArray(field) ||
        ![
          'text',
          'file',
          'folder',
          'select',
          'number',
          'boolean',
          'targets',
          'lines',
          'json',
        ].includes(field.kind) ||
        Object.keys(field).some((key) => !['kind', 'hint', 'min', 'max', 'options'].includes(key))
      )
        throw new Error('Invalid input control')
      if (
        (field.hint !== undefined &&
          (typeof field.hint !== 'string' || field.hint.length > 4096)) ||
        ['min', 'max'].some(
          (key) =>
            field[key] !== undefined &&
            (typeof field[key] !== 'number' || !Number.isFinite(field[key])),
        )
      )
        throw new Error('Invalid input control')
      if (
        field.options !== undefined &&
        (!Array.isArray(field.options) ||
          field.options.length > 100 ||
          field.options.some(
            (option) =>
              !option || typeof option.value !== 'string' || typeof option.label !== 'string',
          ))
      )
        throw new Error('Invalid input choices')
      if (!compatible(field.kind, definition.kind))
        throw new Error('Input control does not match its value type')
      definition.field = field
    }
    if (input.editor !== undefined) {
      if (typeof input.editor !== 'string' || !/^[a-zA-Z0-9_.-]{1,120}$/.test(input.editor))
        throw new Error('Invalid input editor')
      definition.editor = input.editor
    }
    if (
      input.draft !== undefined &&
      (typeof input.draft !== 'string' || input.draft.length > 1024 * 1024)
    )
      throw new Error('Invalid unfinished input')
    return {
      ...definition,
      value: inputValue(definition, input.value),
      ...(input.draft !== undefined ? { draft: input.draft } : {}),
    }
  })
}

function valuesFor(inputs, overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))
    throw new Error('Invalid input values')
  for (const key of Object.keys(overrides))
    if (!inputs.some((input) => input.key === key)) throw new Error(`Unknown card input: ${key}`)
  return Object.fromEntries(
    inputs.map((input) => [
      input.key,
      inputValue(input, Object.hasOwn(overrides, input.key) ? overrides[input.key] : input.value),
    ]),
  )
}

function compatible(fieldKind, inputKind) {
  if (fieldKind === inputKind) return true
  if (fieldKind === 'json' || inputKind === 'json') return true
  if (['targets', 'lines'].includes(fieldKind)) return ['lines', 'urls'].includes(inputKind)
  if (fieldKind === 'number') return inputKind === 'number'
  if (fieldKind === 'boolean') return inputKind === 'boolean'
  return inputKind === 'text'
}

function normalizeBindings(bindings = {}, inputs, runner) {
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings))
    throw new Error('Invalid input connections')
  for (const [field, reference] of Object.entries(bindings)) {
    if (!validKey(field)) throw new Error('Invalid input connection')
    const descriptor = runner?.fields?.find((item) => item.key === field)
    if (runner && !descriptor) throw new Error(`Input cannot be used for unknown setting: ${field}`)
    if (typeof reference !== 'string' && (!reference || typeof reference !== 'object'))
      throw new Error('Invalid input connection')
    if (typeof reference === 'object' && reference !== null) {
      if (
        Array.isArray(reference) ||
        Boolean(reference.input) === Boolean(reference.step) ||
        !validKey(reference.input ?? reference.step) ||
        Object.keys(reference).some((key) => !['input', 'step', 'path'].includes(key)) ||
        !Array.isArray(reference.path ?? []) ||
        (reference.path ?? []).length > 32 ||
        (reference.path ?? []).some((key) => typeof key !== 'string' || !key || reserved.has(key))
      )
        throw new Error('Invalid data reference')
      if (reference.step) continue // Validate step availability and dependency with the whole graph.
    }
    const key = typeof reference === 'string' ? reference : reference.input
    if (!validKey(key)) throw new Error('Invalid input connection')
    const input = inputs.find((item) => item.key === key)
    if (!input) throw new Error(`Card input unavailable: ${key}`)
    if (runner) {
      if (!reference.path?.length && !compatible(descriptor.kind, input.kind))
        throw new Error(`Input “${input.label}” cannot be used for ${descriptor?.label ?? field}`)
    }
  }
  return { ...bindings }
}

function selectPath(value, path = []) {
  for (const key of path) {
    if (
      reserved.has(key) ||
      value === null ||
      typeof value !== 'object' ||
      !Object.hasOwn(value, key)
    )
      throw new Error(`Result property unavailable: ${path.join('.')}`)
    value = value[key]
  }
  return copy(value)
}
const hasStepBindings = (node) => Object.values(node.bindings ?? {}).some((ref) => ref?.step)
function resolveConfig(node, values, results = new Map()) {
  const config = copy(node.config)
  for (const [field, reference] of Object.entries(node.bindings ?? {})) {
    const key = typeof reference === 'string' ? reference : reference.input
    if (reference?.step) {
      if (!results.has(reference.step))
        throw new Error(`Step result unavailable: ${reference.step}`)
      config[field] = selectPath(results.get(reference.step), reference.path)
      continue
    }
    if (!validKey(field) || !Object.hasOwn(values, key))
      throw new Error(`Card input unavailable: ${key}`)
    config[field] = selectPath(values[key], reference.path)
  }
  return config
}
module.exports = {
  normalizeInputs,
  valuesFor,
  normalizeBindings,
  resolveConfig,
  compatible,
  hasStepBindings,
  jsonValue,
}
