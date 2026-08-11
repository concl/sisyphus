import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import styles from './TerminalPane.module.css'

const TERM_THEME = {
  background: '#0d0f14',
  foreground: '#c9ced8',
  cursor: '#c9ced8',
  cursorAccent: '#0d0f14',
  selectionBackground: 'rgba(91, 140, 255, 0.3)',
  black: '#202638',
  red: '#f07178',
  green: '#7dc98a',
  yellow: '#e5c07b',
  blue: '#5b8cff',
  magenta: '#c792ea',
  cyan: '#56b6c2',
  white: '#c9ced8',
  brightBlack: '#7c8496',
  brightRed: '#ff7b85',
  brightGreen: '#9be3a7',
  brightYellow: '#ffd88a',
  brightBlue: '#7aa7ff',
  brightMagenta: '#d8a7f5',
  brightCyan: '#7fd6e0',
  brightWhite: '#ffffff',
}

interface TerminalPaneProps {
  ptyId: string
  backendId: string
  active: boolean
  onExit: (exitCode: number) => void
}

export function TerminalPane({ ptyId, backendId, active, onExit }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const onExitRef = useRef(onExit)

  // Keep the latest onExit callback in a ref (used by event handlers).
  useEffect(() => {
    onExitRef.current = onExit
  })

  // Create the xterm instance once per pane.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      theme: TERM_THEME,
      scrollback: 5000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(host)
    termRef.current = term
    fitRef.current = fit

    const unData = term.onData((data) => window.terminals?.write(ptyId, data))
    const unResize = term.onResize(({ cols, rows }) => window.terminals?.resize(ptyId, cols, rows))

    return () => {
      unData.dispose()
      unResize.dispose()
      window.terminals?.kill(ptyId)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [ptyId])

  // Spawn (or respawn, when the backend changes) the shell for this pane.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    let cancelled = false

    term.clear()
    window.terminals?.spawn({ ptyId, backendId, cols: term.cols, rows: term.rows }).then((res) => {
      if (cancelled) return
      if (!res.ok) {
        term.writeln(`\r\n\x1b[31mFailed to start shell:\x1b[0m ${res.error || 'unknown error'}`)
        onExitRef.current(-1)
      }
    })

    return () => {
      cancelled = true
    }
  }, [backendId, ptyId])

  // Route main-process output/exit events for this pane.
  useEffect(() => {
    const offData = window.terminals?.onData(({ ptyId: id, data }) => {
      if (id === ptyId) termRef.current?.write(data)
    })
    const offExit = window.terminals?.onExit(({ ptyId: id, exitCode }) => {
      if (id !== ptyId) return
      const term = termRef.current
      if (term) {
        term.writeln(`\r\n\x1b[90m[shell exited with code ${exitCode}]\x1b[0m`)
      }
      onExitRef.current(exitCode)
    })
    return () => {
      offData?.()
      offExit?.()
    }
  }, [ptyId])

  // Keep the terminal sized to its container while this pane is visible.
  useEffect(() => {
    if (!active) return
    const host = hostRef.current
    if (!host) return

    const fitNow = () => {
      try {
        fitRef.current?.fit()
      } catch {
        /* container hidden or zero-sized */
      }
    }
    const raf = requestAnimationFrame(fitNow)
    const observer = new ResizeObserver(fitNow)
    observer.observe(host)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [active])

  return <div className={styles.container} ref={hostRef} />
}
