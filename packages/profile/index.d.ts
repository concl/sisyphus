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
  /** Mounts a plugin that arrived at runtime, such as a file the user added. */
  add(entry: ProfileEntry): Promise<void>
  /** Disposes a plugin and forgets it, so it leaves the composition. */
  unmount(id: string): Promise<void>
  /** Swaps a mounted plugin for new code, keeping its enabled switch. */
  replace(id: string, plugin: Plugin): Promise<void>
  setEnabled(id: string, enabled: boolean): Promise<void>
  subscribe(listener: (statuses: PluginStatus[]) => void): () => void
  dispose(): Promise<void>
}
