import { readable, type Backend, type Desktop } from '@sisyphus/sdk'
import type { SessionFactory, TerminalSession, TerminalTab } from './types'

interface TerminalState {
  backends: Backend[]
  shellId: string
  tabs: TerminalTab[]
  activeId: string | null
  loading: boolean
  error: string
}

export function createTerminalStore(desktop: Desktop, createSession: SessionFactory) {
  let state: TerminalState = {
    backends: [],
    shellId: '',
    tabs: [],
    activeId: null,
    loading: false,
    error: '',
  }
  const listeners = new Set<() => void>()
  const sessions = new Map<string, TerminalSession>()
  const versions = new Map<string, symbol>()
  const closing = new Set<Promise<void>>()
  let load: Promise<void> | undefined
  let initialized = false
  let disposed = false
  let sequence = 0
  const update = (patch: Partial<TerminalState>) => {
    if (disposed) return
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }
  const release = (session?: TerminalSession) => {
    if (!session) return Promise.resolve()
    const pending = session.dispose().catch((error) => update({ error: readable(error) }))
    closing.add(pending)
    void pending.finally(() => closing.delete(pending))
    return pending
  }
  function start(tab: TerminalTab, version: symbol) {
    if (disposed || versions.get(tab.id) !== version) return
    try {
      const session = createSession(tab.shell, (status) => {
        if (versions.get(tab.id) !== version) return
        update({
          tabs: state.tabs.map((item) => (item.id === tab.id ? { ...item, status } : item)),
        })
      })
      sessions.set(tab.id, session)
      // Publish the new surface after a restart, even if its status is unchanged.
      update({ tabs: [...state.tabs] })
    } catch (error) {
      update({
        tabs: state.tabs.map((item) =>
          item.id === tab.id
            ? { ...item, status: { state: 'error', message: readable(error) } }
            : item,
        ),
      })
    }
  }
  const store = {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    loadBackends() {
      if (disposed) return Promise.resolve()
      if (load) return load
      update({ loading: true, error: '' })
      load = desktop
        .call<{ backends: Backend[]; defaultId: string }>('terminal.backends')
        .then((result) => {
          if (disposed) return
          const shellId =
            result.backends.find((item) => item.id === state.shellId)?.id ??
            result.backends.find((item) => item.id === result.defaultId)?.id ??
            result.backends[0]?.id ??
            ''
          update({ backends: result.backends, shellId })
          if (!initialized) {
            initialized = true
            if (shellId) store.open(shellId)
          }
        })
        .catch((error) => update({ error: readable(error) }))
        .finally(() => {
          load = undefined
          update({ loading: false })
        })
      return load
    },
    setShell(shellId: string) {
      if (state.backends.some((item) => item.id === shellId)) update({ shellId })
    },
    open(shellId = state.shellId) {
      if (disposed) return
      const shell = state.backends.find((item) => item.id === shellId)
      if (!shell) {
        update({ error: 'Choose an available shell.' })
        return
      }
      const id = crypto.randomUUID()
      const version = Symbol()
      versions.set(id, version)
      const tab: TerminalTab = {
        id,
        shell,
        title: `${shell.name} ${++sequence}`,
        status: { state: 'starting' },
      }
      update({ tabs: [...state.tabs, tab], activeId: id, error: '' })
      start(tab, version)
      return id
    },
    select(id: string) {
      if (state.tabs.some((tab) => tab.id === id)) update({ activeId: id })
    },
    session: (id: string) => sessions.get(id),
    close(id: string) {
      const index = state.tabs.findIndex((tab) => tab.id === id)
      if (index === -1) return Promise.resolve()
      const session = sessions.get(id)
      versions.delete(id)
      sessions.delete(id)
      const tabs = state.tabs.filter((tab) => tab.id !== id)
      update({
        tabs,
        activeId:
          state.activeId === id
            ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null)
            : state.activeId,
      })
      return release(session)
    },
    async restart(id: string) {
      const tab = state.tabs.find((tab) => tab.id === id)
      if (!tab || disposed) return
      const version = Symbol()
      versions.set(id, version)
      const previous = sessions.get(id)
      sessions.delete(id)
      update({
        tabs: state.tabs.map((item) =>
          item.id === id ? { ...item, status: { state: 'starting' } } : item,
        ),
      })
      await release(previous)
      start(tab, version)
    },
    async dispose() {
      if (disposed) return
      disposed = true
      versions.clear()
      await Promise.all([...sessions.values()].map(release).concat([...closing]))
      sessions.clear()
      listeners.clear()
    },
  }
  return store
}

export type TerminalStore = ReturnType<typeof createTerminalStore>
