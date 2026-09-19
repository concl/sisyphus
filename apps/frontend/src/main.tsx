import { Profile } from '@sisyphus/profile'
import { applyStates } from '@sisyphus/profile/preferences'
import { createRoot } from 'react-dom/client'
import { services, type AppPlugin, type Desktop, type Storage, type Workspace } from '@sisyphus/sdk'
import { createLibrary, DEFAULT_LAYOUT, installGlobals } from './host'
import { profile } from './profile'
import './index.css'

async function boot() {
  const runtime = new Profile()
  // React, the SDK, and the UI are handed over before a plugin is evaluated, so a
  // plugin's `import { useState } from 'react'` and this app's are the same hook.
  installGlobals()
  await runtime.mount(profile().map((plugin) => ({ id: plugin.id, plugin })))
  const desktop = runtime.get<Desktop>(services.desktop)
  const library = createLibrary({
    runtime,
    call: (method, input) => desktop.call(method, input),
    on: (event, listener) => desktop.on(event, listener),
    layout: DEFAULT_LAYOUT,
  })
  // The library is a plugin too, and providing it is how a panel reaches the plugin
  // list. It mounts before the plugins it loads, so they can inject the service.
  const libraryPlugin: AppPlugin = {
    id: 'platform.plugins',
    name: 'Plugin library',
    provide: [services.plugins],
    apply(ctx) {
      ctx.provide(services.plugins, library)
    },
  }
  await runtime.mount([{ id: 'platform.plugins', plugin: libraryPlugin }])
  // Mount every plugin the distribution shipped plus anything added since, then let
  // the switches from earlier sessions settle them.
  await library.refresh()
  await applyStates(runtime, runtime.get<Storage>(services.storage))
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
  const dispose = () => {
    root.unmount()
    library.dispose()
    void runtime.dispose()
  }
  window.addEventListener('beforeunload', dispose)
  if (import.meta.hot) import.meta.hot.dispose(dispose)
}
void boot().catch((error) => {
  document.getElementById('root')!.textContent = `Could not start workspace: ${error}`
})
