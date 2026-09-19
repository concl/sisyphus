import { useEffect, useState } from 'react'
import {
  services,
  type AppPlugin,
  type Desktop,
  type Panels,
  type PythonServer,
} from '@sisyphus/sdk'
import icon from './icon.svg'

export const pythonPlugin: AppPlugin = {
  id: 'feature.python-host',
  name: 'Python Host',
  inject: [services.panels, services.desktop],
  apply(ctx) {
    const desktop = ctx.get(services.desktop) as Desktop
    const panels = ctx.get(services.panels) as Panels
    function PythonPanel() {
      const [servers, setServers] = useState<PythonServer[]>([])
      const [error, setError] = useState('')
      const [busy, setBusy] = useState<string | null>(null)
      const [response, setResponse] = useState('')
      useEffect(() => {
        let alive = true
        const refresh = () =>
          desktop
            .call<PythonServer[]>('python.list')
            .then((result) => {
              if (alive) {
                setServers(result)
                setError('')
              }
            })
            .catch((error) => {
              if (alive) setError(String(error))
            })
        void refresh()
        const timer = setInterval(refresh, 1500)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [])
      async function action(id: string, method: string) {
        setBusy(id)
        setError('')
        try {
          if (method === 'call')
            setResponse(
              JSON.stringify(await desktop.call('python.call', { id, path: '/api/info' }), null, 2),
            )
          else setServers(await desktop.call<PythonServer[]>(`python.${method}`, { id }))
        } catch (error) {
          setError(String(error))
        } finally {
          setBusy(null)
        }
      }
      return (
        <div className="python-panel">
          <div className="eyebrow">LOCAL SERVICES</div>
          <h2>
            Python Host
            <span className="python-mark">
              <img src={icon} alt="" />
            </span>
          </h2>
          <p className="muted">A home for your Python servers.</p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {servers.map((server) => (
            <section className="server-card" key={server.id}>
              <div className="server-heading">
                <strong>{server.name}</strong>
                <span className={`status-pill ${server.state}`}>
                  <i />
                  {server.state}
                </span>
              </div>
              <p className="server-url">
                {server.url ?? 'Ready when you are'}
                {server.pid ? ` · PID ${server.pid}` : ''}
              </p>
              <div className="server-actions">
                <button
                  className="primary"
                  disabled={busy === server.id || server.state === 'starting'}
                  onClick={() =>
                    void action(server.id, server.state === 'running' ? 'stop' : 'start')
                  }
                >
                  {server.state === 'running'
                    ? 'Stop server'
                    : server.state === 'starting'
                      ? 'Starting…'
                      : 'Start server'}
                </button>
                <button
                  disabled={busy === server.id || server.state !== 'running'}
                  onClick={() => void action(server.id, 'call')}
                >
                  Test API ↗
                </button>
              </div>
              {server.error && <p className="error">{server.error}</p>}
              <details>
                <summary>
                  Server output <span>{server.logs.length}</span>
                </summary>
                <pre>
                  {server.logs.join('\n') || 'Output will appear here when the server starts.'}
                </pre>
              </details>
            </section>
          ))}
          {response && (
            <section className="api-response">
              <div className="section-label">API RESPONSE</div>
              <pre>{response}</pre>
            </section>
          )}
          <div className="quiet-note">
            <span>◎</span> Servers run on your machine. Closing this block keeps them running;
            disabling the host or quitting stops them.
          </div>
        </div>
      )
    }
    ctx.effect(() =>
      panels.register({
        id: 'python-host',
        title: 'Python Host',
        icon,
        description: 'Run local services. Keep them close.',
        component: PythonPanel,
      }),
    )
  },
}
