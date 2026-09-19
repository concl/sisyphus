import { createRoot } from 'react-dom/client'
import { Profile } from '@sisyphus/profile'
import { services, type Workspace } from '@sisyphus/sdk'
import { profile } from './profile'
import './index.css'

async function boot() {
  const runtime = new Profile()
  await runtime.mount(profile(runtime).map((plugin) => ({ id: plugin.id, plugin })))
  const root = createRoot(document.getElementById('root')!)
  const render = () => {
    try {
      const Shell = runtime.get<Workspace>(services.workspace).component
      root.render(<Shell />)
    } catch {
      root.render(
        <div className="boot-error">
          <h1>Workspace unavailable</h1>
          <p>Check the plugin profile and reload to recover.</p>
          <button onClick={() => location.reload()}>Reload workspace</button>
          <pre>{JSON.stringify(runtime.list(), null, 2)}</pre>
        </div>,
      )
    }
  }
  runtime.subscribe(render)
  render()
  window.addEventListener('beforeunload', () => {
    root.unmount()
    void runtime.dispose()
  })
  if (import.meta.hot)
    import.meta.hot.dispose(() => {
      root.unmount()
      void runtime.dispose()
    })
}
void boot().catch((error) => {
  document.getElementById('root')!.textContent = `Could not start workspace: ${error}`
})
