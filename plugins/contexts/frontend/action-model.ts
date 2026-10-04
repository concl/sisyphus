export interface Field {
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
  id: string
  type: string
  title: string
  x: number
  y: number
  config: Record<string, unknown>
  bindings?: Record<string, Binding>
}
export interface CardInput {
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
  if (fieldKind === 'json' || inputKind === 'json') return true
  if (fieldKind === 'targets' || fieldKind === 'lines')
    return inputKind === 'lines' || inputKind === 'urls'
  if (fieldKind === 'number') return inputKind === 'number'
  if (fieldKind === 'boolean') return inputKind === 'boolean'
  return inputKind === 'text'
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
