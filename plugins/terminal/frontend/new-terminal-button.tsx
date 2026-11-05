import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import type { TerminalStore } from './store'
import { CheckIcon, ChevronIcon, PlusIcon, RestartIcon, ShellIcon } from './icons'

export function NewTerminalButton({ store }: { store: TerminalStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [open, setOpen] = useState(false)
  const [menuHeight, setMenuHeight] = useState(280)
  const group = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const shell = state.backends.find((item) => item.id === state.shellId)
  function showMenu(next: boolean) {
    const button = trigger.current?.getBoundingClientRect()
    const panel = group.current?.closest('.terminal-panel')?.getBoundingClientRect()
    if (button && panel)
      setMenuHeight(Math.max(72, Math.min(320, panel.bottom - button.bottom - 8)))
    setOpen(next)
  }
  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const outside = (event: PointerEvent) => {
      if (!group.current?.contains(event.target as Node)) setOpen(false)
    }
    const close = () => setOpen(false)
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', close)
    }
  }, [open])
  function navigate(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
      return
    }
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }
    const items = [
      ...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
        []),
    ]
    if (!items.length) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    let next: number
    if (event.key === 'ArrowDown') next = (current + 1) % items.length
    else if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else return
    event.preventDefault()
    items[next].focus()
  }
  return (
    <div className="terminal-new-group" ref={group}>
      <button
        className="terminal-icon-button terminal-new"
        aria-label="New terminal"
        title={`New terminal${shell ? ` (${shell.name})` : ''}`}
        disabled={state.loading || !shell}
        onClick={() => {
          setOpen(false)
          store.open()
        }}
      >
        <PlusIcon />
      </button>
      <button
        className="terminal-icon-button terminal-profile-toggle"
        ref={trigger}
        aria-label="Select shell"
        title="Select shell"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            showMenu(true)
          }
        }}
        onClick={() => {
          showMenu(!open)
        }}
      >
        <ChevronIcon />
      </button>
      {open && (
        <div
          className="terminal-profile-menu"
          ref={menu}
          id={menuId}
          role="menu"
          aria-label="Shell profiles"
          style={{ maxHeight: menuHeight }}
          onKeyDown={navigate}
        >
          <div className="terminal-menu-heading">New terminal</div>
          {state.backends.map((backend) => (
            <button
              role="menuitem"
              key={backend.id}
              data-shell-id={backend.id}
              onClick={() => {
                setOpen(false)
                store.setShell(backend.id)
                store.open(backend.id)
              }}
            >
              <ShellIcon shell={backend.id} />
              <span>{backend.name}</span>
              {backend.id === state.shellId && (
                <span className="terminal-profile-check" title="Used by the + button">
                  <CheckIcon />
                </span>
              )}
            </button>
          ))}
          {!state.backends.length && (
            <p className="terminal-menu-empty">
              {state.loading ? 'Loading shells…' : 'No shells available.'}
            </p>
          )}
          <div className="terminal-menu-separator" role="separator" />
          <button
            role="menuitem"
            disabled={state.loading}
            onClick={() => {
              setOpen(false)
              void store.loadBackends()
            }}
          >
            <RestartIcon />
            <span>Reload shells</span>
          </button>
        </div>
      )}
    </div>
  )
}
