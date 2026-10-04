export interface Field {
  required?: boolean
  editor?: string
  expose?: boolean
  key: string
  label: string
  kind: 'text' | 'file' | 'folder' | 'targets' | 'lines' | 'number' | 'select' | 'boolean' | 'json'
  hint?: string
  min?: number
  max?: number
  options?: { value: string; label: string }[]
  when?: { key: string; value: string }
}
export interface StepType {
  effects?: string[]
  calls?: string[]
  notes?: string[]
  examples?: { title: string; input: Record<string, unknown>; output?: unknown }[]
  presentation?: string
  type: string
  name: string
  description: string
  fields: Field[]
  defaults: Record<string, unknown>
  outputs?: Field[]
  aliases?: string[]
  icon?: string
  service?: { id: string; name: string }
}
export type Binding =
  string | { step: string; path?: string[] } | { input: string; path?: string[] }
export interface SourceOption {
  reference: Binding
  label: string
}
export const inputKey = (ref: Binding) =>
  typeof ref === 'string' ? ref : 'input' in ref ? ref.input : undefined
export const stepKey = (ref: Binding) =>
  typeof ref === 'object' && 'step' in ref ? ref.step : undefined
export const bindingId = (ref?: Binding) =>
  !ref
    ? ''
    : typeof ref === 'string'
      ? ref
      : JSON.stringify({ ...ref, path: 'step' in ref ? ref.path?.slice(0, 1) : [] })
export const findType = (types: StepType[], type?: string) =>
  types.find((item) => item.type === type || item.aliases?.includes(type ?? ''))
export interface Step {
  drafts?: Record<string, string>
  id: string
  type: string
  title: string
  x: number
  y: number
  config: Record<string, unknown>
  bindings?: Record<string, Binding>
}
export interface CardInput {
  draft?: string
  field?: Omit<Field, 'key' | 'label' | 'when' | 'expose' | 'editor'>
  editor?: string
  key: string
  label: string
  kind: 'text' | 'number' | 'boolean' | 'lines' | 'urls' | 'json'
  value: unknown
}
export function cardInputFor(field: Field, value: unknown): CardInput {
  return {
    key: crypto.randomUUID(),
    label: field.label,
    editor: field.editor,
    kind: (['number', 'boolean', 'json'].includes(field.kind)
      ? field.kind
      : ['lines', 'targets'].includes(field.kind)
        ? 'lines'
        : 'text') as CardInput['kind'],
    field: {
      kind: field.kind,
      ...(field.hint !== undefined ? { hint: field.hint } : {}),
      ...(field.min !== undefined ? { min: field.min } : {}),
      ...(field.max !== undefined ? { max: field.max } : {}),
      ...(field.options ? { options: field.options } : {}),
    },
    value,
  }
}
export interface Edge {
  from: string
  to: string
}
export const inputField = (input: CardInput, label = input.label): Field => ({
  ...input.field,
  key: 'value',
  label,
  editor: input.editor,
  kind: input.field?.kind ?? (input.kind === 'urls' ? 'lines' : input.kind),
})
export interface Flow {
  id: string
  programId?: string
  title: string
  description: string
  color: string
  inputs?: CardInput[]
  nodes: Step[]
  edges: Edge[]
}
export interface NodeRun {
  title: string
  status: string
  output: string
  result?: unknown
  error?: string
}
export interface Run {
  id: string
  runId: string
  status: string
  startedAt: number
  finishedAt?: number
  inputValues?: Record<string, unknown>
  nodes: Record<string, NodeRun>
}
export const colors = ['blue', 'green', 'amber', 'purple', 'rose', 'slate']
export const errorMessage = (problem: unknown) =>
  (problem instanceof Error ? problem.message : String(problem))
    .replace(/^Error: /, '')
    .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
export const WIDTH = 220
export const HEIGHT = 120
export const start = { x: 30, y: 60 }
export function connectionError(edges: Edge[], from: string, to: string): string | null {
  if (from === to || to === 'start') return 'Connect an output to a different step’s input.'
  if (edges.some((edge) => edge.from === from && edge.to === to))
    return 'These steps are already connected.'
  const visited = new Set<string>()
  const reaches = (id: string): boolean => {
    if (id === from) return true
    if (visited.has(id)) return false
    visited.add(id)
    return edges.filter((edge) => edge.from === id).some((edge) => reaches(edge.to))
  }
  return reaches(to) ? 'That connection would create a loop.' : null
}
export const compatibleInput = (
  fieldKind: Field['kind'],
  inputKind: CardInput['kind'] | Field['kind'],
) => {
  if (fieldKind === inputKind) return true
  if (fieldKind === 'json' || inputKind === 'json') return true
  if (fieldKind === 'targets' || fieldKind === 'lines')
    return inputKind === 'lines' || inputKind === 'urls'
  if (fieldKind === 'number') return inputKind === 'number'
  if (fieldKind === 'boolean') return inputKind === 'boolean'
  return inputKind === 'text'
}

export interface ReadinessIssue {
  nodeId?: string
  message: string
}

/** Insert on an existing path. Graph mode may instead add a parallel branch. */
export function insertStep(flow: Flow, node: Step, after: string, branch = false): Flow {
  const outgoing = flow.edges.filter((edge) => edge.from === after)
  return {
    ...flow,
    nodes: [...flow.nodes, node],
    edges: branch
      ? [...flow.edges, { from: after, to: node.id }]
      : [
          ...flow.edges.filter((edge) => edge.from !== after),
          { from: after, to: node.id },
          ...outgoing.map((edge) => ({ from: node.id, to: edge.to })),
        ],
  }
}

export function removeStep(flow: Flow, id: string): Flow {
  const incoming = flow.edges.filter((edge) => edge.to === id)
  const outgoing = flow.edges.filter((edge) => edge.from === id)
  const edges = flow.edges.filter((edge) => edge.from !== id && edge.to !== id)
  for (const before of incoming)
    for (const after of outgoing)
      if (!edges.some((edge) => edge.from === before.from && edge.to === after.to))
        edges.push({ from: before.from, to: after.to })
  // Retain result references so the editor asks the user to replace the source.
  // Silently reverting to an old literal could run with an unintended value.
  const nodes = flow.nodes.filter((node) => node.id !== id)
  // Keep named card inputs: they may be deliberate reusable workflow parameters.
  return { ...flow, nodes, edges }
}

/** Stable topological display order; disconnected draft steps remain visible. */
export function orderedSteps(flow: Flow): Step[] {
  const remaining = [...flow.nodes]
  const done = new Set(['start'])
  const result: Step[] = []
  while (remaining.length) {
    const index = remaining.findIndex((node) =>
      flow.edges.filter((edge) => edge.to === node.id).every((edge) => done.has(edge.from)),
    )
    if (index < 0) return [...result, ...remaining]
    const [node] = remaining.splice(index, 1)
    result.push(node)
    done.add(node.id)
  }
  return result
}
export const resolvedConfig = (node: Step, inputs: CardInput[]) => ({
  ...node.config,
  ...Object.fromEntries(
    Object.entries(node.bindings ?? {}).map(([field, ref]) => [
      field,
      typeof ref === 'object' && 'step' in ref
        ? undefined
        : (typeof ref === 'object' ? (ref.path ?? []) : []).reduce<unknown>(
            (value, key) =>
              value && typeof value === 'object' && Object.hasOwn(value, key)
                ? (value as Record<string, unknown>)[key]
                : undefined,
            inputs.find((input) => input.key === inputKey(ref))?.value,
          ),
    ]),
  ),
})
export const nodeSummary = (node: Step, inputs: CardInput[] = []) => {
  const references = Object.values(node.bindings ?? {})
  if (references.some((ref) => stepKey(ref))) return 'Uses a step result'
  const input = inputs.find((input) => references.some((ref) => inputKey(ref) === input.key))
  if (input) return `Uses ${input.label}`
  return (
    Object.values(node.config)
      .filter((value) => typeof value === 'string' && value)
      .slice(0, 2)
      .join(' · ') || 'Select to configure'
  )
}
