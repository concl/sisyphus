import type { Plugin } from '@deepseek-ai/cordis'
export interface PluginStatus {
  id: string
  name: string
  enabled: boolean
  state: 'waiting' | 'starting' | 'active' | 'failed' | 'disabled' | 'stopping'
  error?: string
  requires: string[]
  provides: string[]
}
export interface ProfileEntry {
  id: string
  plugin: Plugin
}
export class Profile {
  constructor()
  get<T>(service: string): T
  list(): PluginStatus[]
  mount(entries: ProfileEntry[]): Promise<void>
  setEnabled(id: string, enabled: boolean): Promise<void>
  subscribe(listener: (statuses: PluginStatus[]) => void): () => void
  dispose(): Promise<void>
}
