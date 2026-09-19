import type { ComponentType } from 'react'
import type { Plugin } from '@deepseek-ai/cordis'
import type { PluginStatus } from '@sisyphus/profile'
export type AppPlugin = Plugin.Object<void> & { id: string }
export const services = {
  panels: 'ui.panels.v1',
  storage: 'storage.v1',
  desktop: 'desktop.v1',
  workspace: 'ui.workspace.v1',
  theme: 'ui.theme.v1',
} as const
export interface PanelProps {
  instanceId: string
}
export interface PanelDefinition {
  id: string
  title: string
  description: string
  icon: string
  component: ComponentType<PanelProps>
  multiple?: boolean
}
export interface Panels {
  register(panel: PanelDefinition): () => void
  list(): readonly PanelDefinition[]
  subscribe(listener: () => void): () => void
  open(id: string): void
  onOpen(listener: (id: string) => void): () => void
}
export interface Storage {
  get<T>(scope: string, key: string): Promise<T | undefined>
  set(scope: string, key: string, value: unknown): Promise<void>
}
export interface Backend {
  id: string
  name: string
}
export interface PythonServer {
  id: string
  name: string
  state: 'stopped' | 'starting' | 'running' | 'failed'
  pid?: number
  url?: string
  error?: string
  logs: string[]
}
export interface Desktop {
  call<T = unknown>(method: string, input?: unknown): Promise<T>
  on<T>(event: string, listener: (value: T) => void): () => void
}
export interface RuntimeControl {
  list(): PluginStatus[]
  setEnabled(id: string, enabled: boolean): Promise<void>
  subscribe(listener: (statuses: PluginStatus[]) => void): () => void
}
export interface Workspace {
  component: ComponentType
}
export type ThemePreference = 'system' | 'light' | 'dark'
export interface ThemeState {
  theme: ThemePreference
  dark: boolean
}
export interface Theme {
  getSnapshot(): ThemeState
  subscribe(listener: () => void): () => void
  set(theme: ThemePreference): Promise<void>
}
export interface ChatConfig {
  baseURL: string
  model: string
  systemPrompt: string
  defaultSystemPrompt: string
  access: 'none' | 'read' | 'write'
  hasApiKey: boolean
}
export interface ChatToolActivity {
  id: string
  name: string
  input: unknown
  status: string
  output?: string
}
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  tools?: ChatToolActivity[]
  status?: string
  error?: string
}
export interface ChatThread {
  id: string
  title: string
  updatedAt: string
  messages: ChatMessage[]
  /** Folder this conversation may read, edit, and run commands in. */
  folder?: string | null
}
/** One entry in the composer's @-mention picker. */
export interface FileEntry {
  path: string
  type: 'file' | 'folder'
}
