import {
  Component,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type ReactNode,
} from 'react'
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
import {
  dropPanel,
  movePanel,
  orderedPanels,
  readRailOrder,
  readSavedLayout,
  rememberArrangement,
  type SavedLayout,
} from './layout'
import shipIcon from './ship-lineart.svg'

/** A layout a previous session saved: the dock arrangement, and the rail order of the time. */
type StoredLayout = SerializedDockview | SavedLayout<SerializedDockview>

function migrateLayout(layout: SerializedDockview): SerializedDockview {
  return { ...layout, floatingGroups: [], popoutGroups: [],
    panels: Object.fromEntries(Object.entries(layout.panels).map(([id, panel]) =>
      [id, panel.params?.type === 'planner' ? { ...panel, title: 'To-dos', params: { ...panel.params, type: 'todo' } } : panel])),
  }
}

class PanelBoundary extends Component<{ children: ReactNode; version?: unknown }, { error: string }> {
  state = { error: '' }
  static getDerivedStateFromError(error: Error) {
    return { error: error.message }
  }
  componentDidUpdate(previous: { version?: unknown }) {
    // Different code for the same block is a fresh start: a problem reported by the
    // version that was just thrown away must not sit on top of its replacement.
    if (previous.version !== this.props.version && this.state.error) this.setState({ error: '' })
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

/**
 * Closes the blocks whose panel is no longer contributed, and keeps the titles of the
 * ones that are current.
 *
 * A reload does not reach here. The panel registry holds a withdrawal for a turn and
 * lets the plugin's new code take the id back inside it, so the contribution a block
 * draws never leaves the list and the block is never told anything changed. What does
 * reach here is a contribution that is really gone - a plugin unmounted, deleted, or
 * switched off - and that is when its blocks close, the way the drawer describes it.
 *
 * Note that a block's `params.type` is the panel id its plugin registered (`chat`),
 * not the plugin id (`feature.chat`): the two are chosen by the plugin and are not
 * meant to be derived from each other, so nothing here matches one against the other.
 */
function pruneBlocks(api: DockviewApi, panels: Panels) {
  for (const panel of [...api.panels]) {
    const type = panel.params?.type
    const definition = panels.list().find((item) => item.id === type)
    if (!definition) {
      api.removePanel(panel)
      continue
    }
    if (panel.title !== definition.title) panel.api.setTitle(definition.title)
  }
}

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
            <PanelBoundary version={Content}>
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
        const [savedLayouts, setSavedLayouts] = useState<Record<string, StoredLayout>>({})
        /** The rail order the person arranged; an empty arrangement is the registry's order. */
        const [arrangement, setArrangement] = useState<string[]>([])
        const [dragging, setDragging] = useState('')
        /** Where a dragged icon would land: an index between two icons, or null off the rail. */
        const [insertAt, setInsertAt] = useState<number | null>(null)
        const rail = orderedPanels(available, arrangement)
        const [runtimePlugins, setRuntimePlugins] = useState(runtime.list())
        const [nativePlugins, setNativePlugins] = useState<PluginStatus[]>([])
        const [message, setMessage] = useState('')
        const [busy, setBusy] = useState(false)
        useEffect(() => runtime.subscribe(setRuntimePlugins), [])
        useEffect(() => {
          void storage
            .get<Record<string, StoredLayout>>('ui.workspace', 'saved-layouts.v1')
            .then((value) => setSavedLayouts(value ?? {}))
            .catch((error) => setMessage(String(error)))
        }, [])
        // The rail order is read as the window lays out rather than when the dock
        // reports ready: it is what the rail draws from its first frame, and waiting
        // for the dock would show the registry's order and then replace it.
        useEffect(() => {
          let alive = true
          void storage
            .get<string[]>('ui.workspace', 'rail.v1')
            .then((order) => {
              if (alive) setArrangement(readRailOrder(order))
            })
            .catch((error) => setMessage(String(error)))
          return () => {
            alive = false
          }
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

        /** Records the rail order and saves it, the way the dock layout is saved. */
        function saveArrangement(order: string[]) {
          setArrangement(order)
          void storage
            .set('ui.workspace', 'rail.v1', order)
            .catch((error) => setMessage(`The rail order could not be saved: ${error}`))
        }

        /** Records an order the rail moved to, keeping a place for what it does not show. */
        function commitArrangement(order: string[]) {
          const ids = rail.map((panel) => panel.id)
          if (order.every((id, index) => id === ids[index])) return
          saveArrangement(rememberArrangement(order, arrangement))
        }

        /** Takes the place of another icon, which is the move the arrow keys ask for. */
        function moveInRail(from: number, to: number) {
          const ids = rail.map((panel) => panel.id)
          commitArrangement(movePanel(ids, from, to))
        }

        /**
         * Where in the rail the pointer is: an index between two icons, or null when it
         * is not over one. An icon's middle is the split - above it is before, below it
         * is after - so what is highlighted is the gap the block would land in.
         */
        function dropIndex(event: DragEvent<HTMLElement>) {
          const target = event.target as HTMLElement | null
          const icon = target?.closest<HTMLElement>('button[data-open]')
          const index = icon ? rail.findIndex((panel) => panel.id === icon.dataset.open) : -1
          if (!icon || index < 0) return null
          const box = icon.getBoundingClientRect()
          return event.clientY < box.top + box.height / 2 ? index : index + 1
        }

        function dropInRail(event: DragEvent<HTMLElement>) {
          event.preventDefault()
          const ids = rail.map((panel) => panel.id)
          const from = ids.indexOf(dragging)
          const at = insertAt ?? dropIndex(event)
          setDragging('')
          setInsertAt(null)
          if (from < 0 || at === null) return
          commitArrangement(dropPanel(ids, from, at))
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
          const prune = () => pruneBlocks(api, panels)
          const offPanels = panels.subscribe(prune)
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
              prune()
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

        /** Restores the default arrangement: the default blocks, and the registry's rail order. */
        function restoreDefaultLayout() {
          reset()
          saveArrangement([])
        }

        async function saveNamedLayout() {
          const name = layoutName.trim()
          if (!dock.current || !name || name.length > 60) return
          // A layout is both arrangements: where the blocks sit, and the order the rail
          // shows them in.
          const next: Record<string, StoredLayout> = {
            ...savedLayouts,
            [name]: { layout: dock.current.toJSON(), rail: arrangement },
          }
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
            const stored = readSavedLayout(savedLayouts[name])
            api.fromJSON(migrateLayout(stored.layout))
            pruneBlocks(api, panels)
            // A layout saved before the rail was part of one leaves the rail alone.
            if (stored.rail !== null) saveArrangement(stored.rail)
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
                {/*
                 * The rail is the blocks in the order the person arranged them, and it is
                 * drag-and-drop because that order is theirs to make: an icon is picked up
                 * and dropped into the gap it belongs in, and the gap is what is
                 * highlighted. The registry's order is only the starting point (it is how
                 * Settings, which registers a high priority, leads the rail until the person
                 * says otherwise), and the arrangement is saved with the layout.
                 */}
                <div
                  className="rail-top"
                  onDragOver={(event) => {
                    if (!dragging) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    const at = dropIndex(event)
                    if (at !== null && at !== insertAt) setInsertAt(at)
                  }}
                  onDrop={dropInRail}
                  onDragLeave={(event) => {
                    // Only leaving the rail clears the gap; moving between icons keeps it.
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                      setInsertAt(null)
                  }}
                >
                  {rail.map((panel, index) => (
                    <button
                      title={`${panel.title} — drag, or press Alt with an arrow key, to move it`}
                      aria-label={`Open ${panel.title}`}
                      data-open={panel.id}
                      key={panel.id}
                      className={
                        dragging === panel.id
                          ? 'dragging'
                          : insertAt === index
                            ? 'drop-before'
                            : insertAt === rail.length && index === rail.length - 1
                              ? 'drop-after'
                              : ''
                      }
                      draggable
                      onDragStart={(event) => {
                        setDragging(panel.id)
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', panel.id)
                      }}
                      onDragEnd={() => {
                        setDragging('')
                        setInsertAt(null)
                      }}
                      onKeyDown={(event) => {
                        if (!event.altKey) return
                        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                        event.preventDefault()
                        moveInRail(index, event.key === 'ArrowUp' ? index - 1 : index + 1)
                      }}
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
                <button
                  title="Reset layout"
                  aria-label="Reset layout"
                  onClick={restoreDefaultLayout}
                >
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
                  <button className="reset-button" onClick={restoreDefaultLayout}>
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
                {available.length} blocks available <b>·</b> Drag tabs and rail icons to arrange{' '}
                <b>·</b> Layout saved on this device
              </span>
            </footer>
          </div>
        )
      }
      ctx.provide(services.workspace, { component: Workspace })
    },
  }
}

