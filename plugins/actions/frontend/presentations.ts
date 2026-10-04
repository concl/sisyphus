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
  input?: ComponentType<ActionInputProps>
  result?: ComponentType<ActionResultProps>
}
export class ActionPresentations {
  private entries = new Map<string, ActionPresentation>()
  private listeners = new Set<() => void>()
  private revision = 0
  getSnapshot = () => this.revision
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private changed() {
    this.revision++
    for (const listener of this.listeners) listener()
  }
  register(id: string, presentation: ActionPresentation) {
    if (this.entries.has(id)) throw new Error(`Duplicate action presentation: ${id}`)
    this.entries.set(id, presentation)
    this.changed()
    return () => {
      if (this.entries.get(id) !== presentation) return
      this.entries.delete(id)
      this.changed()
    }
  }
  get(id?: string) {
    return id ? this.entries.get(id) : undefined
  }
}
