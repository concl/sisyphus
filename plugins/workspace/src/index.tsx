import { Component, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type SerializedDockview,
} from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import type { PluginStatus } from '@sisyphus/profile'
import { writeState } from '@sisyphus/profile/preferences'
import {
  services,
  type AppPlugin,
  type Desktop,
  type Panels,
  type RuntimeControl,
  type Storage,
} from '@sisyphus/sdk'
import './workspace.css'
import shipIcon from './ship-lineart.svg'

function migrateLayout(layout: SerializedDockview): SerializedDockview {
  return { ...layout, floatingGroups: [], popoutGroups: [],
    panels: Object.fromEntries(Object.entries(layout.panels).map(([id, panel]) =>
      [id, panel.params?.type === 'planner' ? { ...panel, title: 'To-dos', params: { ...panel.params, type: 'todo' } } : panel])),
  }
}

class PanelBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' }
  static getDerivedStateFromError(error: Error) {
    return { error: error.message }
  }
  render() {
    return this.state.error ? (
      <div className="panel-error">
        <h2>This block encountered a problem.</h2>
        <p>{this.state.error}</p>
        <button onClick={() => this.setState({ error: '' })}>Retry</button>
      </div>
    ) : (
      this.props.children
    )
  }
}

interface DefaultPanel {
  id: string
  direction?: 'right' | 'below'
  reference?: string
  width?: number
  height?: number
}

// Desktop providers the drawer lists, in the order they appear.
const PROVIDER_LABELS: Record<string, string> = {
  'desktop.terminal': 'Shell provider',
  'desktop.python-host': 'Python provider',
  'desktop.files': 'Files and folders',
  'desktop.shell': 'Agent commands',
  'desktop.plugin-loader': 'Plugins you add',
}
/** A plugin that can be switched off from this drawer: a feature, or one you wrote. */
const switchable = (id: string) => id.startsWith('feature.') || id.startsWith('user.')

export function workspacePlugin(runtime: RuntimeControl, defaults: DefaultPanel[]): AppPlugin {
  return {
    id: 'ui.workspace',
    name: 'Docked workspace',
    inject: [services.panels, services.storage, services.desktop, services.theme],
    provide: [services.workspace],
    apply(ctx) {
      const panels = ctx.get(services.panels) as Panels
      const storage = ctx.get(services.storage) as Storage
      const desktop = ctx.get(services.desktop) as Desktop
      const components = {
        block: ({ params, api }: IDockviewPanelProps<{ type: string }>) => {
          const definition = panels.list().find((panel) => panel.id === params.type)
          if (!definition)
            return (
              <div className="panel-error">
                This plugin is unavailable. Re-enable it in Plugins.
              </div>
            )
          const Content = definition.component
          return (
            <PanelBoundary>
              <Content instanceId={api.id} />
            </PanelBoundary>
          )
        },
      }
      function Workspace() {
        const available = useSyncExternalStore(panels.subscribe, panels.list)
        const dock = useRef<DockviewApi | null>(null)
        const dispose = useRef<() => void>(() => {})
        const [showPlugins, setShowPlugins] = useState(false)
        const [addMenu, setAddMenu] = useState(false)
        const [showLayouts, setShowLayouts] = useState(false)
        const [layoutName, setLayoutName] = useState('')
        const [savedLayouts, setSavedLayouts] = useState<Record<string, SerializedDockview>>({})
        const [runtimePlugins, setRuntimePlugins] = useState(runtime.list())
        const [nativePlugins, setNativePlugins] = useState<PluginStatus[]>([])
        const [message, setMessage] = useState('')
        const [busy, setBusy] = useState(false)
        useEffect(() => runtime.subscribe(setRuntimePlugins), [])
        useEffect(() => {
          void storage
            .get<Record<string, SerializedDockview>>('ui.workspace', 'saved-layouts.v1')
            .then((value) => setSavedLayouts(value ?? {}))
            .catch((error) => setMessage(String(error)))
        }, [])
        useEffect(() => {
          let alive = true
          desktop
            .call<PluginStatus[]>('runtime.list')
            .then((result) => {
              if (alive) setNativePlugins(result)
            })
            .catch((error) => {
              if (alive) setMessage(String(error))
            })
          return () => {
            alive = false
          }
        }, [])
        useEffect(() => () => dispose.current(), [])

        function addPanel(type: string) {
          const api = dock.current
          const definition = panels.list().find((panel) => panel.id === type)
          if (!api || !definition) return
          const existing = api.panels.find((panel) => panel.params?.type === type)
          if (existing && !definition.multiple) {
            existing.api.setActive()
            return
          }
          api.addPanel({
            id: `${type}-${crypto.randomUUID()}`,
            component: 'block',
            title: definition.title,
            params: { type },
            renderer: 'onlyWhenVisible',
          })
        }

        async function ready({ api }: DockviewReadyEvent) {
          dock.current = api
          let alive = true
          let restoring = true
          let timer: ReturnType<typeof setTimeout> | undefined
          const persist = () => {
            if (restoring || !alive) return
            clearTimeout(timer)
            timer = setTimeout(() => {
              void storage.set('ui.workspace', 'layout.v1', api.toJSON()).catch((error) => {
                if (alive) setMessage(`Layout could not be saved: ${error}`)
              })
            }, 250)
          }
          const layout = api.onDidLayoutChange(persist)
          const removeMissing = () => {
            for (const panel of [...api.panels]) {
              const definition = panels.list().find((item) => item.id === panel.params?.type)
              if (!definition) api.removePanel(panel)
              else if (panel.title !== definition.title) panel.api.setTitle(definition.title)
            }
          }
          const offPanels = panels.subscribe(removeMissing)
          const offOpen = panels.onOpen(addPanel)
          dispose.current = () => {
            if (!restoring)
              void storage.set('ui.workspace', 'layout.v1', api.toJSON()).catch(() => {})
            alive = false
            clearTimeout(timer)
            layout.dispose()
            offPanels()
            offOpen()
            dock.current = null
          }
          try {
            const saved = await storage.get<SerializedDockview>('ui.workspace', 'layout.v1')
            if (!alive) return
            if (saved) {
              // This workspace is tiled; ignore unsupported floating/popout state.
              api.fromJSON(migrateLayout(saved))
              removeMissing()
            } else reset()
          } catch {
            if (alive) {
              api.clear()
              reset()
              setMessage('The saved layout could not be restored. A fresh workspace is ready.')
            }
          } finally {
            restoring = false
          }
        }

        function reset() {
          const api = dock.current
          if (!api) return
          api.clear()
          for (const item of defaults) {
            const definition = panels.list().find((panel) => panel.id === item.id)
            if (!definition) continue
            api.addPanel({
              id: item.id,
              component: 'block',
              title: definition.title,
              params: { type: item.id },
              renderer: 'onlyWhenVisible',
              initialWidth: item.width,
              initialHeight: item.height,
              position: item.direction
                ? {
                    direction: item.direction,
                    referencePanel: api.getPanel(item.reference ?? '') ? item.reference : undefined,
                  }
                : undefined,
            })
          }
          api.panels[0]?.api.setActive()
        }

        async function saveNamedLayout() {
          const name = layoutName.trim()
          if (!dock.current || !name || name.length > 60) return
          const next = { ...savedLayouts, [name]: dock.current.toJSON() }
          try {
            await storage.set('ui.workspace', 'saved-layouts.v1', next)
            setSavedLayouts(next)
            setLayoutName('')
            setMessage(`Saved layout “${name}”.`)
          } catch (error) {
            setMessage(String(error))
          }
        }

        function openNamedLayout(name: string) {
          try {
            const api = dock.current
            if (!api) return
            api.fromJSON(migrateLayout(savedLayouts[name]))
            for (const panel of [...api.panels]) {
              const definition = panels.list().find((item) => item.id === panel.params?.type)
              if (!definition) api.removePanel(panel)
              else if (panel.title !== definition.title) panel.api.setTitle(definition.title)
            }
            setShowLayouts(false)
          } catch (error) {
            setMessage(`Could not open layout: ${error}`)
          }
        }

        async function toggle(plugin: PluginStatus, native = false) {
          setBusy(true)
          const enabled = !plugin.enabled
          try {
            if (native)
              setNativePlugins(
                await desktop.call<PluginStatus[]>('runtime.enable', {
                  id: plugin.id,
                  enabled,
                }),
              )
            else {
              await runtime.setEnabled(plugin.id, enabled)
              // The native side records its own switches; this one is ours.
              await writeState(storage, plugin.id, enabled)
            }
          } catch (error) {
            setMessage(String(error))
          } finally {
            setBusy(false)
          }
        }

        return (
          <div className="workspace">
            <header className="workspace-header">
              <div className="brand">
                <span
                  className="brand-symbol"
                  style={{ maskImage: `url("${shipIcon}")` }}
                  aria-hidden="true"
                />
                <strong>sisyphus</strong>
                <span className="brand-divider" />
                <span className="workspace-name">Personal workspace</span>
              </div>
              <div className="header-actions">
                <span className="local-indicator">
                  <i /> LOCAL
                </span>
                <button
                  className={`header-action ${showPlugins ? 'selected' : ''}`}
                  onClick={() => setShowPlugins(!showPlugins)}
                >
                  Plugins
                </button>
                <div className="layout-control">
                  <button
                    aria-label="Saved layouts"
                    className={`header-action ${showLayouts ? 'selected' : ''}`}
                    onClick={() => setShowLayouts(!showLayouts)}
                  >
                    Layouts
                  </button>
                  {showLayouts && (
                    <div className="layout-menu">
                      <strong>Saved layouts</strong>
                      {Object.keys(savedLayouts).length ? (
                        Object.keys(savedLayouts)
                          .sort()
                          .map((name) => (
                            <button key={name} onClick={() => openNamedLayout(name)}>
                              {name}
                            </button>
                          ))
                      ) : (
                        <p>No saved layouts yet.</p>
                      )}
                      <form
                        onSubmit={(event) => {
                          event.preventDefault()
                          void saveNamedLayout()
                        }}
                      >
                        <input
                          aria-label="Layout name"
                          placeholder="Name this layout"
                          maxLength={60}
                          value={layoutName}
                          onChange={(event) => setLayoutName(event.target.value)}
                        />
                        <button className="primary" type="submit">
                          Save
                        </button>
                      </form>
                    </div>
                  )}
                </div>
                <div className="add-block">
                  <button
                    className={`header-action header-add-action ${addMenu ? 'selected' : ''}`}
                    onClick={() => setAddMenu(!addMenu)}
                  >
                    Add block
                  </button>
                  {addMenu && (
                    <div className="block-menu">
                      {available.map((panel) => (
                        <button
                          key={panel.id}
                          onClick={() => {
                            addPanel(panel.id)
                            setAddMenu(false)
                          }}
                        >
                          <span>
                            <span
                              className="icon-mask"
                              style={{ maskImage: `url("${panel.icon}")` }}
                              aria-hidden="true"
                            />
                          </span>
                          {panel.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </header>
            <div className="workspace-body">
              <nav className="rail" aria-label="Blocks">
                <div className="rail-top">
                  {available.map((panel) => (
                    <button
                      title={panel.title}
                      aria-label={`Open ${panel.title}`}
                      data-open={panel.id}
                      key={panel.id}
                      onClick={() => addPanel(panel.id)}
                    >
                      <span
                        className="icon-mask"
                        style={{ maskImage: `url("${panel.icon}")` }}
                        aria-hidden="true"
                      />
                    </button>
                  ))}
                </div>
                <button title="Reset layout" aria-label="Reset layout" onClick={reset}>
                  ⊞
                </button>
              </nav>
              <main className="dock-area">
                <DockviewReact
                  className="dockview-theme-dark"
                  components={components}
                  onReady={(event) => {
                    void ready(event)
                  }}
                  disableFloatingGroups
                  defaultRenderer="onlyWhenVisible"
                  watermarkComponent={() => (
                    <div className="empty-workspace">
                      <span>⊞</span>
                      <h2>Make space for your next idea.</h2>
                      <p>Choose a block from the rail or Add block.</p>
                    </div>
                  )}
                />
              </main>
              {showPlugins && (
                <aside className="plugin-drawer">
                  <div className="drawer-title">
                    <h2>Your plugins</h2>
                    <button aria-label="Close plugins" onClick={() => setShowPlugins(false)}>
                      ×
                    </button>
                  </div>
                  <p className="muted">Each piece has its own lifecycle.</p>
                  <div className="section-label">WORKSPACE</div>
                  {runtimePlugins.map((plugin) => (
                    <div className="plugin-row" key={plugin.id}>
                      <div>
                        <strong>{plugin.name}</strong>
                        <small>{plugin.error ?? plugin.state}</small>
                      </div>
                      {switchable(plugin.id) ? (
                        <button
                          role="switch"
                          aria-checked={plugin.enabled}
                          aria-label={plugin.name}
                          disabled={busy}
                          onClick={() => void toggle(plugin)}
                          className={`toggle ${plugin.enabled ? 'on' : ''}`}
                        >
                          <span />
                        </button>
                      ) : (
                        <span className="infra-label">service</span>
                      )}
                    </div>
                  ))}
                  <div className="section-label">DESKTOP SERVICES</div>
                  {nativePlugins
                    .filter((plugin) => plugin.id in PROVIDER_LABELS)
                    .map((plugin) => (
                      <div className="plugin-row" key={plugin.id}>
                        <div>
                          <strong>{PROVIDER_LABELS[plugin.id]}</strong>
                          <small>{plugin.error ?? plugin.state}</small>
                        </div>
                        <button
                          role="switch"
                          aria-checked={plugin.enabled}
                          aria-label={plugin.id}
                          disabled={busy}
                          className={`toggle ${plugin.enabled ? 'on' : ''}`}
                          onClick={() => void toggle(plugin, true)}
                        >
                          <span />
                        </button>
                      </div>
                    ))}
                  <p className="drawer-note">
                    Turning off a feature removes its blocks. Turning off a desktop provider stops
                    its processes. Reopen blocks after enabling a provider. Add or edit plugins of
                    your own in Plugin studio.
                  </p>
                  <button className="reset-button" onClick={reset}>
                    Restore default layout ↗
                  </button>
                </aside>
              )}
            </div>
            {message && (
              <div className="workspace-message" role="alert">
                {message}
                <button aria-label="Dismiss message" onClick={() => setMessage('')}>
                  ×
                </button>
              </div>
            )}
            <footer className="workspace-status">
              <span>
                <i /> Local first. Yours to sync.
              </span>
              <span>
                {available.length} blocks available <b>·</b> Drag tabs to arrange <b>·</b> Layout
                saved on this device
              </span>
            </footer>
          </div>
        )
      }
      ctx.provide(services.workspace, { component: Workspace })
    },
  }
}

