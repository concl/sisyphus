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
  planner: 'planner.v1',
  /**
   * The plugins the app is running, and the folder they came from. Every panel
   * reads this to list, reload, or edit a plugin, so a plugin the user writes and
   * a plugin the distribution shipped are the same kind of thing.
   */
  plugins: 'app.plugins.v1',
} as const
export interface PlannerItem {
  id: string
  kind: 'todo' | 'event'
  title: string
  date?: string
  done?: boolean
  deleted?: boolean
  updatedAt: string
  actor: string
}
export interface PlannerSnapshot {
  records: PlannerItem[]
  folder: string | null
  error: string
}
export interface Planner {
  getSnapshot(): PlannerSnapshot
  subscribe(listener: () => void): () => void
  create(input: { title: string; date?: string }): Promise<unknown>
  update(id: string, changes: { title?: string; date?: string | null; done?: boolean }): Promise<unknown>
  remove(id: string): Promise<unknown>
  chooseFolder(): Promise<void>
  sync(): Promise<void>
}
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
  /** Higher-priority panels are shown first in workspace navigation. Defaults to 0. */
  priority?: number
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
  dropFiles(files: File[], folder: string | null): Promise<DroppedFilesResult>
}
export interface RuntimeControl {
  list(): PluginStatus[]
  setEnabled(id: string, enabled: boolean): Promise<void>
  subscribe(listener: (statuses: PluginStatus[]) => void): () => void
  /** Mounts a plugin that arrived while the app was running, such as a new file. */
  add(entry: { id: string; plugin: AppPlugin }): Promise<void>
  /** Swaps a mounted plugin for new code, keeping its position and enabled switch. */
  replace(id: string, plugin: AppPlugin): Promise<void>
  /** Disposes a plugin and forgets it, so it leaves the composition. */
  unmount(id: string): Promise<void>
}
/**
 * A panel only ever wants the reason an operation failed. An IPC rejection carries
 * Electron's wrapper around it, so this is how a message reaches the screen intact.
 */
export function readable(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  const marker = text.lastIndexOf('Error: ')
  return marker === -1 ? text : text.slice(marker + 'Error: '.length)
}
/**
 * One plugin file on disk. `main` files are loaded by the native half, `renderer`
 * files by this window, and a file with an unusable name is reported with a null
 * target and an explanation instead of being loaded.
 *
 * A file the distribution shipped and a file the user wrote are described the same
 * way; `shipped` and `edited` say where it came from, and neither changes how it is
 * loaded, enabled, or reloaded.
 */
export interface PluginLibraryEntry {
  version?: string
  id: string
  target: 'main' | 'renderer' | null
  file: string
  /** Order the composition gives it; a file with no order mounts after the rest. */
  order?: number
  /** True when this file came from the build inside the distribution. */
  shipped?: boolean
  /** True when a shipped file no longer matches the copy the distribution built. */
  edited?: boolean
  /** How a built artifact hands its plugin over, when it is one. */
  export?: string
  needs?: string[]
  css?: string | null
  error?: string
  enabled?: boolean
  state?: PluginStatus['state']
}
/** Everything Plugin studio needs to draw one list. */
export interface PluginLibrarySnapshot {
  loading: boolean
  folder: string
  watching: boolean
  plugins: PluginLibraryEntry[]
  error?: string
}
export interface PluginLibrary {
  getSnapshot(): PluginLibrarySnapshot
  subscribe(listener: () => void): () => void
  /** Reads the folder and mounts what belongs to this process. */
  refresh(): Promise<void>
  read(id: string, target: string): Promise<{ source: string; file: string; css?: string }>
  save(id: string, target: string, source: string): Promise<void>
  create(id: string, target: string): Promise<void>
  remove(id: string, target: string): Promise<void>
  reload(id: string, target: string): Promise<void>
  reloadAll(): Promise<void>
  /** Copies the shipped version back over an edited or deleted plugin file. */
  restore(id: string, target: string): Promise<void>
  setWatching(watching: boolean): Promise<void>
  reveal(id?: string, target?: string): Promise<void>
  /** Stops following the folder and forgets the listeners. */
  dispose(): void
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
/**
 * Budgets a reply runs under, editable in Settings > Chat. Every budget accepts 0
 * for "no limit", and no limit is the default: a reply keeps working until it is
 * done, and a limit is only ever something the user asked for.
 */
export interface ChatLimits {
  /** Model calls (tool steps) one reply may take. 0 keeps going until it answers. */
  maxSteps: number
  /** Retries for a single model call. */
  maxRetries: number
  /** Seconds to wait for the reply to start. 0 waits as long as it takes. */
  firstChunkSeconds: number
  /**
   * Seconds of silence between chunks before a reply counts as stalled. Time
   * spent inside a tool does not count towards it. 0 disables the check.
   */
  chunkSeconds: number
  /** Seconds one tool call may run before it fails. 0 lets it take as long as it needs. */
  toolSeconds: number
}
export interface ChatConfig {
  baseURL: string
  model: string
  systemPrompt: string
  defaultSystemPrompt: string
  access: 'none' | 'read' | 'write'
  /** Saved limits for this device. */
  limits: ChatLimits
  /** Values a "restore defaults" control writes back. */
  defaultLimits: ChatLimits
  hasApiKey: boolean
}
export interface ChatToolActivity {
  id: string
  name: string
  input: unknown
  status: string
  output?: string
}
/**
 * One ordered piece of an assistant reply: text the model wrote, reasoning it
 * thought out loud, or a tool it called. Rendering follows this order, so a
 * reply can read reasoning, tool, text.
 */
export type ChatMessagePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; toolId: string }
  /**
   * The app's own explanation (a limit was reached, a reply stalled). It is not
   * model output and a panel must not render it like an answer.
   */
  | { type: 'notice'; text: string }
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  /**
   * The message this one answers; null starts a conversation. Two messages that
   * share a parent are two attempts at the same turn, and editing a message
   * adds a sibling instead of rewriting history.
   */
  parentId?: string | null
  /**
   * Reasoning the model streamed while it worked, kept for the transcript. It
   * is display material only: the answer is `text`.
   */
  reasoning?: string
  tools?: ChatToolActivity[]
  /** Absent on replies stored before ordering was recorded. */
  parts?: ChatMessagePart[]
  /**
   * The app's words about the reply: a limit was reached, the reply has no text.
   * Never part of `text`, so it cannot be read as something the model wrote.
   */
  notice?: string
  status?: string
  error?: string
  context?: ChatContext
}
export interface ChatContext {
  tokens: number
  inputTokens?: number
  outputTokens?: number
  estimated: boolean
}
export interface ChatThread {
  id: string
  title: string
  updatedAt: string
  messages: ChatMessage[]
  /** Message whose branch is on screen; a leaf of the message tree. */
  activeLeafId?: string | null
  /** Folder this conversation may read, edit, and run commands in. */
  folder?: string | null
}
/** One entry in the composer's @-mention picker. */
export interface FileEntry {
  path: string
  type: 'file' | 'folder'
}
export type DroppedFilesResult =
  | { status: 'accepted'; entries: FileEntry[] }
  | {
      status: 'needs-folder'
      suggestedFolder: string
      folderName: string
      names: string[]
    }
  | { status: 'rejected'; message: string }
export interface VSCodeContextAction {
  integration: 'vscode'
  folders: string[]
  profile?: string
  window: 'new' | 'reuse'
}
export interface BrowserContextAction {
  integration: 'browser'
  urls: string[]
}
export type AppContextAction = VSCodeContextAction | BrowserContextAction
export interface AppContext {
  id: string
  name: string
  actions: AppContextAction[]
}
export interface IntegrationStatus {
  id: string
  name: string
  available: boolean
}
