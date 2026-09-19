import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { services, type AppPlugin, type Desktop, type Panels, type Backend } from '@sisyphus/sdk'
import icon from './icon.svg'

export const terminalPlugin: AppPlugin = {
  id: 'feature.terminal',
  name: 'Terminal',
  inject: [services.panels, services.desktop],
  apply(ctx) {
    const desktop = ctx.get(services.desktop) as Desktop
    const panels = ctx.get(services.panels) as Panels
    function TerminalPanel() {
      const host = useRef<HTMLDivElement>(null)
      const [backends, setBackends] = useState<Backend[]>([])
      const [backend, setBackend] = useState('')
      const [generation, setGeneration] = useState(0)
      const [status, setStatus] = useState('Connecting…')
      useEffect(() => {
        let alive = true
        desktop
          .call<{ backends: Backend[]; defaultId: string }>('terminal.backends')
          .then((result) => {
            if (alive) {
              setBackends(result.backends)
              setBackend(result.defaultId)
            }
          })
          .catch((error) => {
            if (alive) setStatus(String(error))
          })
        return () => {
          alive = false
        }
      }, [])
      useEffect(() => {
        if (!backend || !host.current) return
        const id = crypto.randomUUID()
        let alive = true
        let spawned = false
        const term = new Terminal({
          fontFamily: '"Cascadia Code", Consolas, monospace',
          fontSize: 13,
          lineHeight: 1.35,
          cursorBlink: true,
          scrollback: 5000,
          theme: {
            background: '#171b1e',
            foreground: '#d0d8d5',
            cursor: '#b5d9bd',
            selectionBackground: '#334c42',
            black: '#171b1e',
            green: '#b5d9bd',
            blue: '#9bbfe0',
          },
        })
        const fit = new FitAddon()
        term.loadAddon(fit)
        term.open(host.current)
        const ignore = () => {}
        const offData = desktop.on<{ id: string; data: string }>('terminal.data', (event) => {
          if (event.id === id && alive) term.write(event.data)
        })
        const offExit = desktop.on<{ id: string; exitCode: number }>('terminal.exit', (event) => {
          if (event.id === id && alive) {
            spawned = false
            setStatus(`Exited · ${event.exitCode}`)
            term.writeln(`\r\n[Process exited: ${event.exitCode}]`)
          }
        })
        const input = term.onData((data) => {
          if (spawned) void desktop.call('terminal.write', { id, data }).catch(ignore)
        })
        const resize = () => {
          if (!host.current?.clientWidth || !host.current.clientHeight) return
          fit.fit()
          if (spawned)
            void desktop
              .call('terminal.resize', { id, cols: term.cols, rows: term.rows })
              .catch(ignore)
        }
        const observer = new ResizeObserver(resize)
        observer.observe(host.current)
        desktop
          .call<{ pid: number }>('terminal.spawn', {
            id,
            backendId: backend,
            cols: term.cols,
            rows: term.rows,
          })
          .then((result) => {
            if (!alive) {
              void desktop.call('terminal.kill', { id }).catch(ignore)
              return
            }
            spawned = true
            setStatus(`Running · PID ${result.pid}`)
            resize()
            term.focus()
          })
          .catch((error) => {
            if (alive) {
              setStatus('Unavailable')
              term.writeln(String(error))
            }
          })
        return () => {
          alive = false
          observer.disconnect()
          offData()
          offExit()
          input.dispose()
          term.dispose()
          void desktop.call('terminal.kill', { id }).catch(ignore)
        }
      }, [backend, generation])
      return (
        <div className="terminal-panel">
          <div className="panel-toolbar">
            <select
              aria-label="Shell"
              value={backend}
              onChange={(event) => setBackend(event.target.value)}
            >
              {backends.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <span className="muted">{status}</span>
            <button onClick={() => setGeneration((value) => value + 1)}>Restart ↻</button>
          </div>
          <div className="terminal-host" ref={host} />
        </div>
      )
    }
    ctx.effect(() =>
      panels.register({
        id: 'terminal',
        title: 'Terminal',
        icon,
        description: 'A shell, right where you work.',
        component: TerminalPanel,
        multiple: true,
      }),
    )
  },
}
