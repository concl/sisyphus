import { useEffect, useRef, useState } from 'react'
import { Icon } from '../icons'
import type { TerminalBackend } from '../types'
import { TerminalPane } from './TerminalPane'
import styles from './TerminalPage.module.css'

interface Tab {
  id: number
  ptyId: string
  backendId: string
  dead: boolean
}

interface TerminalPageProps {
  active: boolean
}

const DEFAULT_STORE_KEY = 'terminalDefaultBackend'

export function TerminalPage({ active }: TerminalPageProps) {
  const [backends, setBackends] = useState<TerminalBackend[]>([])
  const [defaultBackendId, setDefaultBackendId] = useState<string | null>(null)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const nextId = useRef(1)
  const createdRef = useRef(false)

  // Load the available shells once. On first open (nothing persisted yet) the
  // OS default shell detected in main.js is stored as the app default.
  useEffect(() => {
    if (!window.terminals) return
    let cancelled = false
    window.terminals
      .listBackends()
      .then(({ backends: list, defaultId }) => {
        if (cancelled) return
        setBackends(list)
        const stored = localStorage.getItem(DEFAULT_STORE_KEY)
        const storedBackend = list.find((b) => b.id === stored)
        const chosen = storedBackend ? storedBackend.id : defaultId
        setDefaultBackendId(chosen)
        localStorage.setItem(DEFAULT_STORE_KEY, chosen)
      })
      .catch((err) => console.error('Failed to load terminal backends:', err))
    return () => {
      cancelled = true
    }
  }, [])

  // Close the shell picker when clicking elsewhere.
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [menuOpen])

  function addTab(backendId?: string) {
    const id = nextId.current++
    setTabs((prev) => [
      ...prev,
      { id, ptyId: `term-${id}`, backendId: backendId ?? defaultBackendId ?? '', dead: false },
    ])
    setActiveId(id)
  }

  function closeTab(id: number) {
    const idx = tabs.findIndex((t) => t.id === id)
    if (idx === -1) return
    const remaining = tabs.filter((t) => t.id !== id)
    if (remaining.length === 0) {
      // Never leave the terminal page empty: replace with a fresh tab.
      const newId = nextId.current++
      setTabs([{ id: newId, ptyId: `term-${newId}`, backendId: defaultBackendId ?? '', dead: false }])
      setActiveId(newId)
    } else {
      setTabs(remaining)
      if (activeId === id) setActiveId(remaining[Math.min(idx, remaining.length - 1)].id)
    }
  }

  function markDead(id: number) {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, dead: true } : t)))
  }

  // Create the first tab the first time the Terminal page is shown.
  useEffect(() => {
    if (active && defaultBackendId && tabs.length === 0 && !createdRef.current) {
      createdRef.current = true
      addTab()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, defaultBackendId])

  if (!window.terminals) {
    return (
      <div className={`${styles.page} ${styles.unavailable}`} data-testid="terminal-page">
        <p>Terminal is only available when running inside the Electron app.</p>
      </div>
    )
  }

  return (
    <div className={styles.page} data-testid="terminal-page">
      <div className={styles.tabs}>
        <div className={styles.tabStrip} role="tablist">
          {tabs.map((tab) => {
            const name = backends.find((b) => b.id === tab.backendId)?.name ?? 'Shell'
            const same = tabs.filter((t) => t.backendId === tab.backendId)
            const label = same.length > 1 ? `${name} ${same.indexOf(tab) + 1}` : name
            const classes = [styles.tab]
            if (tab.id === activeId) classes.push(styles.active)
            if (tab.dead) classes.push(styles.dead)
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.id === activeId}
                className={classes.join(' ')}
                data-testid="terminal-tab"
                onClick={() => setActiveId(tab.id)}
              >
                <span className={styles.dot} />
                <span className={styles.tabName} data-testid="terminal-tab-name">
                  {label}
                </span>
                <span
                  className={styles.tabClose}
                  role="button"
                  aria-label="Close tab"
                  data-testid="terminal-tab-close"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(tab.id)
                  }}
                >
                  ✕
                </span>
              </button>
            )
          })}
        </div>
        <div className={styles.tabActions}>
          <button
            type="button"
            className="icon-btn"
            title="New terminal tab"
            aria-label="New terminal tab"
            onClick={() => addTab()}
          >
            <Icon name="icon-plus" className="icon icon-sm" />
          </button>
          <div className={styles.backendPicker} ref={menuRef}>
            <button
              type="button"
              className="icon-btn"
              title="New terminal with a specific shell"
              aria-label="New terminal with a specific shell"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={backends.length === 0}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Icon name="icon-chevron-down" className="icon icon-sm" />
            </button>
            {menuOpen && (
              <div className={styles.menu} role="menu">
                {backends.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    onClick={() => {
                      addTab(b.id)
                      setMenuOpen(false)
                    }}
                  >
                    {b.name}
                    {b.id === defaultBackendId && <span className={styles.menuDefault}>default</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.stack}>
        {tabs.map((tab) => (
          <TerminalPane
            key={tab.id}
            ptyId={tab.ptyId}
            backendId={tab.backendId}
            active={tab.id === activeId}
            onExit={() => markDead(tab.id)}
          />
        ))}
      </div>
    </div>
  )
}
