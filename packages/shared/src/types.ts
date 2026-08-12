/** A shell backend the terminal page can spawn (e.g. PowerShell, Git Bash). */
export interface TerminalBackend {
  id: string
  name: string
  command: string
  args: string[]
}

export interface TerminalSpawnResult {
  ok: boolean
  error?: string
}

export interface TerminalDataEvent {
  ptyId: string
  data: string
}

export interface TerminalExitEvent {
  ptyId: string
  exitCode: number
}

/** A subprocess owned by the main process (python service, terminal shell). */
export interface ManagedProcessInfo {
  id: string
  kind: 'service' | 'terminal'
  name: string
  running: boolean
  pid?: number
  detail?: Record<string, unknown>
}

/** Health of a managed service (the python-host FastAPI app). */
export interface ServiceStatus {
  id: string
  name: string
  running: boolean
  pid?: number
  url?: string
  healthy?: boolean
  error?: string
}

/** Payload of a renderer -> main proxy call into a managed service's HTTP API. */
export interface ServiceCallRequest {
  path: string
}

export interface ServiceCallResult {
  ok: boolean
  status?: number
  body?: unknown
  error?: string
}
