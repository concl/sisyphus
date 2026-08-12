// Types for the API surface the Electron main process exposes through
// preload.js (window.versions / window.terminals). In a plain browser
// (vite dev without Electron) these are undefined; the UI degrades gracefully.
import type {
  TerminalBackend,
  TerminalSpawnResult,
  TerminalDataEvent,
  TerminalExitEvent,
  ServiceStatus,
  ServiceCallResult,
  ManagedProcessInfo,
  ListedExtension,
} from '@sisyphus/shared'

declare global {
  interface Window {
    versions?: {
      node: () => string
      chrome: () => string
      electron: () => string
      platform: () => string
      ping: () => Promise<string>
    }
    terminals?: {
      listBackends: () => Promise<{ backends: TerminalBackend[]; defaultId: string }>
      spawn: (opts: {
        ptyId: string
        backendId: string
        cols: number
        rows: number
      }) => Promise<TerminalSpawnResult>
      write: (ptyId: string, data: string) => void
      resize: (ptyId: string, cols: number, rows: number) => void
      kill: (ptyId: string) => void
      onData: (cb: (payload: TerminalDataEvent) => void) => () => void
      onExit: (cb: (payload: TerminalExitEvent) => void) => () => void
    }
    services?: {
      status: () => Promise<ServiceStatus>
      call: (path: string) => Promise<ServiceCallResult>
    }
    processes?: {
      list: () => Promise<ManagedProcessInfo[]>
    }
    sisyphus?: {
      extensions: {
        list: () => Promise<ListedExtension[]>
      }
      storage: {
        get: (scope: string, key: string) => Promise<unknown>
        set: (scope: string, key: string, value: unknown) => Promise<void>
        delete: (scope: string, key: string) => Promise<void>
      }
    }
  }
}

export {}
