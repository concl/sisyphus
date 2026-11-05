import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type KeyboardEvent } from 'react'
import type { TerminalStore } from './store'
import type { TerminalSession, TerminalTab } from './types'
import { AlertIcon, RestartIcon, ShellIcon, TrashIcon } from './icons'
import { NewTerminalButton } from './new-terminal-button'

function TerminalSurface({
  session,
  tab,
  active,
}: {
  session?: TerminalSession
  tab: TerminalTab
  active: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (host.current && session && active) return session.attach(host.current)
  }, [session, active])
  return (
    <div
      className="terminal-host"
      ref={host}
      role="tabpanel"
      id={`terminal-panel-${tab.id}`}
      aria-labelledby={`terminal-tab-${tab.id}`}
      hidden={!active}
    />
  )
}

function statusText(tab: TerminalTab) {
  if (tab.status.state === 'running') return 'Running'
  if (tab.status.state === 'starting') return 'Starting…'
  if (tab.status.state === 'exited') return `Exited (${tab.status.exitCode})`
  return tab.status.message || 'Unavailable'
}

export function TerminalPanel({ store }: { store: TerminalStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const active = state.tabs.find((tab) => tab.id === state.activeId)
  useEffect(() => {
    void store.loadBackends()
  }, [store])
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    if (target.getAttribute('role') !== 'tab') return
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    const index = buttons.indexOf(target as HTMLButtonElement)
    let next = index
    if (event.key === 'ArrowDown') next = (index + 1) % buttons.length
    else if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = buttons.length - 1
    else return
    event.preventDefault()
    store.select(state.tabs[next].id)
    requestAnimationFrame(() => buttons[next]?.focus())
  }
  return (
    <div className="terminal-panel">
      <header className="terminal-toolbar">
        <span className="terminal-view-title">Terminal</span>
        <div className="terminal-toolbar-actions" role="group" aria-label="Terminal actions">
          <NewTerminalButton store={store} />
          <span className="terminal-toolbar-divider" aria-hidden="true" />
          <button
            className="terminal-icon-button"
            aria-label="Restart terminal"
            title="Restart terminal"
            disabled={!active || active.status.state === 'starting'}
            onClick={() => active && void store.restart(active.id)}
          >
            <RestartIcon />
          </button>
          <button
            className="terminal-icon-button"
            aria-label="Close terminal"
            title="Close terminal"
            disabled={!active}
            onClick={() => active && void store.close(active.id)}
          >
            <TrashIcon />
          </button>
        </div>
      </header>
      {state.error && (
        <p className="terminal-error" role="alert">
          {state.error}
        </p>
      )}
      <div className="terminal-layout">
        <div className="terminal-content">
          {active?.status.state === 'error' && (
            <p className="terminal-error" role="alert">
              {active.status.message || 'Terminal unavailable.'}
            </p>
          )}
          {!active && (
            <div className="terminal-empty">
              <ShellIcon />
              <p>{state.loading ? 'Loading shells…' : 'No terminals open'}</p>
              {!state.loading && (
                <button disabled={!state.shellId} onClick={() => store.open()}>
                  New terminal
                </button>
              )}
            </div>
          )}
          {state.tabs.map((tab) => (
            <TerminalSurface
              key={tab.id}
              session={store.session(tab.id)}
              tab={tab}
              active={tab.id === state.activeId}
            />
          ))}
          <span className="terminal-sr-only" role="status">
            {active ? `${active.title}: ${statusText(active)}` : ''}
          </span>
        </div>
        <div
          className="terminal-tabs"
          role="tablist"
          aria-label="Terminals"
          aria-orientation="vertical"
          onKeyDown={navigate}
        >
          {state.tabs.map((tab) => (
            <div
              className="terminal-tab-row"
              data-active={tab.id === state.activeId}
              data-state={tab.status.state}
              key={tab.id}
            >
              <button
                role="tab"
                id={`terminal-tab-${tab.id}`}
                aria-controls={`terminal-panel-${tab.id}`}
                aria-selected={tab.id === state.activeId}
                aria-label={`${tab.title}: ${statusText(tab)}`}
                tabIndex={tab.id === state.activeId ? 0 : -1}
                onClick={() => store.select(tab.id)}
                title={`${tab.title} · ${statusText(tab)}`}
              >
                <span className="terminal-shell-icon">
                  <ShellIcon shell={tab.shell.id} />
                </span>
                <span className="terminal-tab-title">{tab.title}</span>
                {tab.status.state === 'starting' && (
                  <span className="terminal-spinner" aria-hidden="true" />
                )}
                {tab.status.state === 'exited' && (
                  <span className="terminal-exit-code">{tab.status.exitCode}</span>
                )}
                {tab.status.state === 'error' && (
                  <span className="terminal-tab-error">
                    <AlertIcon />
                  </span>
                )}
              </button>
              <button
                className="terminal-icon-button terminal-close"
                aria-label={`Close ${tab.title}`}
                title="Close terminal"
                onClick={() => void store.close(tab.id)}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
