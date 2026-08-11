export interface TerminalBackend {
  id: string
  name: string
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
