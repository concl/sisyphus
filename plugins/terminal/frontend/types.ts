import type { Backend } from '@sisyphus/sdk'

export interface SessionStatus {
  state: 'starting' | 'running' | 'exited' | 'error'
  pid?: number
  exitCode?: number
  message?: string
}

export interface TerminalTab {
  id: string
  title: string
  shell: Backend
  status: SessionStatus
}

/** The plugin owns sessions; views only attach and detach their terminal surface. */
export interface TerminalSession {
  attach(host: HTMLElement): () => void
  focus(): void
  dispose(): Promise<void>
}

export type SessionFactory = (
  shell: Backend,
  onStatus: (status: SessionStatus) => void,
) => TerminalSession
