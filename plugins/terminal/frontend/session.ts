import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { readable, type Desktop } from '@sisyphus/sdk'
import type { SessionFactory } from './types'

export function terminalSessionFactory(desktop: Desktop): SessionFactory {
  return (shell, onStatus) => {
    const id = crypto.randomUUID()
    let disposed = false
    let running = false
    let exited = false
    let opened = false
    let disposal: Promise<void> | undefined
    const element = document.createElement('div')
    element.className = 'terminal-emulator'
    const term = new Terminal({
      fontFamily: '"Cascadia Code", Consolas, monospace',
      fontSize: 14,
      fontWeight: 500,
      lineHeight: 1.4,
      cursorBlink: true,
      scrollback: 5000,
      theme: {
        background: '#1a1a1a',
        foreground: '#e2e2e2',
        cursor: '#e2e2e2',
        selectionBackground: '#414141',
        black: '#1a1a1a',
        green: '#8bd5b1',
        blue: '#94a7ff',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    const report = (error: unknown) => {
      if (!disposed && !exited) onStatus({ state: 'error', message: readable(error) })
    }
    const offData = desktop.on<{ id: string; data: string }>('terminal.data', (event) => {
      if (event.id === id && !disposed) term.write(event.data)
    })
    const offExit = desktop.on<{ id: string; exitCode: number }>('terminal.exit', (event) => {
      if (event.id !== id || disposed) return
      running = false
      exited = true
      onStatus({ state: 'exited', exitCode: event.exitCode })
      term.writeln(`\r\n[Process exited: ${event.exitCode}]`)
    })
    const input = term.onData((data) => {
      if (running && !disposed) void desktop.call('terminal.write', { id, data }).catch(report)
    })
    const resize = () => {
      if (disposed || !opened || !element.clientWidth || !element.clientHeight) return
      fit.fit()
      if (running)
        void desktop.call('terminal.resize', { id, cols: term.cols, rows: term.rows }).catch(report)
    }
    const observer = new ResizeObserver(resize)
    const spawning = desktop
      .call<{ pid: number }>('terminal.spawn', {
        id,
        backendId: shell.id,
        cols: term.cols,
        rows: term.rows,
      })
      .then((result) => {
        if (disposed || exited) return
        running = true
        onStatus({ state: 'running', pid: result.pid })
        resize()
      })
      .catch((error) => {
        report(error)
        if (!disposed) term.writeln(readable(error))
      })
    return {
      attach(host) {
        if (disposed) return () => {}
        host.append(element)
        if (!opened) {
          term.open(element)
          opened = true
          observer.observe(element)
        }
        resize()
        term.focus()
        return () => {
          if (element.parentElement === host) element.remove()
        }
      },
      focus() {
        if (!disposed && opened) term.focus()
      },
      dispose() {
        if (disposal) return disposal
        disposed = true
        running = false
        observer.disconnect()
        offData()
        offExit()
        input.dispose()
        term.dispose()
        element.remove()
        // A close during startup waits for spawn before killing that exact PTY.
        // Each restart has a fresh ID, so late cleanup cannot kill its replacement.
        disposal = spawning.then(() => desktop.call('terminal.kill', { id })).then(() => {})
        return disposal
      },
    }
  }
}
