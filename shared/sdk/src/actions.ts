import type { ComponentType } from 'react'

export interface ActionInputProps {
  value: unknown
  change: (value: unknown) => void
  disabled?: boolean
}
export interface ActionResultProps {
  value: unknown
}
export interface ActionPresentation {
  summary?: ComponentType<ActionResultProps>
  input?: ComponentType<ActionInputProps>
  result?: ComponentType<ActionResultProps>
}
/** Disposable presentation registry provided by ui.actions.v1. */
export interface ActionPresentations {
  getSnapshot(): number
  subscribe(listener: () => void): () => void
  register(id: string, presentation: ActionPresentation): () => void
  get(id?: string): ActionPresentation | undefined
}
