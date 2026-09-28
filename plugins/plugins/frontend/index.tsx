import { useState, useSyncExternalStore } from 'react'
import { writeState } from '@sisyphus/profile/preferences'
import {
  readable,
  services,
  type AppPlugin,
  type Desktop,
  type Panels,
  type PluginLibrary,
  type PluginLibraryEntry,
  type RuntimeControl,
  type Storage,
} from '@sisyphus/sdk'
import icon from './icon.svg'
import './plugins.css'

/**
 * Manage the plugins this app is running.
 *
 * Loading them is the window's job, not a plugin's (`bootstrap/frontend/src/host.ts`
 * owns the library and provides it), so this plugin only draws what the library
 * reports. Shipped and user plugins share the same controls.
 */
export function pluginsPlugin(runtime: RuntimeControl): AppPlugin {
  return {
    id: 'feature.plugins',
    name: 'Plugins',
    inject: [services.panels, services.desktop, services.storage, services.plugins],
    apply(ctx) {
      const panels = ctx.get(services.panels) as Panels
      const desktop = ctx.get(services.desktop) as Desktop
      const storage = ctx.get(services.storage) as Storage
      const host = ctx.get(services.plugins) as PluginLibrary

      // Renderer switches live in this process, so they are recorded here; a
      // native switch is recorded by the native handler that performs it.
      async function toggle(entry: PluginLibraryEntry) {
        const enabled = !entry.enabled
        if (entry.target === 'main') {
          await desktop.call('runtime.enable', { id: entry.id, enabled })
        } else {
          await runtime.setEnabled(entry.id, enabled)
          await writeState(storage, entry.id, enabled)
        }
        await host.refresh()
      }

      function Plugins() {
        const snapshot = useSyncExternalStore(host.subscribe, host.getSnapshot)
        const waiting = snapshot.plugins.filter((entry) => entry.pending).length
        const [open, setOpen] = useState<PluginLibraryEntry | null>(null)
        const [draft, setDraft] = useState('')
        const [original, setOriginal] = useState('')
        const [search, setSearch] = useState('')
        const [busy, setBusy] = useState(false)
        const [notice, setNotice] = useState('')

        const entries = snapshot.plugins.filter((entry) =>
          entry.id.toLowerCase().includes(search.trim().toLowerCase()),
        )

        async function attempt(work: () => Promise<unknown>) {
          setBusy(true)
          setNotice('')
          try {
            await work()
          } catch (error) {
            setNotice(readable(error))
          } finally {
            setBusy(false)
          }
        }

        async function edit(entry: PluginLibraryEntry) {
          await attempt(async () => {
            const file = await host.read(entry.id, entry.target ?? 'main')
            setDraft(file.source)
            setOriginal(file.source)
            setOpen(entry)
          })
        }

        return (
          <div className="plugins-panel">
            <h2>Plugins</h2>
            <p className="plugins-quiet">Manage what’s running in your workspace.</p>

            <div className="plugins-tools">
              <button
                disabled={busy || !snapshot.folder}
                title={snapshot.folder}
                onClick={() => void attempt(() => host.reveal())}
              >
                Open folder
              </button>
              <button
                disabled={busy}
                title={waiting ? 'Mount every file that changed' : 'Load every file again'}
                className={waiting ? 'primary' : undefined}
                onClick={() => void attempt(() => host.reloadAll())}
              >
                Reload all
              </button>
              <label className="plugins-switch" title="Show when plugin files have changed">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={snapshot.watching}
                  onChange={(event) => void attempt(() => host.setWatching(event.target.checked))}
                />
                Watch for changes
              </label>
              <label
                className="plugins-switch"
                title="Apply a noticed change on the spot instead of waiting for Reload"
              >
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={snapshot.reloadOnSave}
                  onChange={(event) =>
                    void attempt(() => host.setReloadOnSave(event.target.checked))
                  }
                />
                Reload on save
              </label>
            </div>

            {(notice || snapshot.error) && (
              <p role="alert" className="plugins-error">
                {notice || snapshot.error}
              </p>
            )}
            {snapshot.loading && <p className="plugins-quiet">Reading plugin files…</p>}

            <div className="plugins-browse">
              <p className="plugins-summary" role="status">
                {entries.length} {entries.length === 1 ? 'plugin' : 'plugins'}
                {waiting > 0 && <span> · {waiting} awaiting reload</span>}
              </p>
              <input
                type="search"
                aria-label="Search plugins"
                placeholder="Search plugins…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            {!snapshot.loading && entries.length === 0 && (
              <p className="plugins-empty">
                {snapshot.plugins.length ? 'No plugins match your search.' : 'No plugins found.'}
              </p>
            )}
            <div className="plugins-grid" role="list" aria-label="Plugins">
              {entries.map((entry) => (
                <article
                  role="listitem"
                  className={`plugins-card ${
                    open && open.id === entry.id && open.target === entry.target ? 'selected' : ''
                  }`}
                  key={`${entry.id}:${entry.target}`}
                >
                  <div className="plugins-card-heading">
                    <div className="plugins-meta">
                      <strong>{entry.id}</strong>
                      <small>
                        {entry.target === 'renderer'
                          ? 'frontend'
                          : entry.target === 'main'
                            ? 'backend'
                            : 'unusable file name'}
                        {entry.shipped ? ' · Built-in' : ' · Custom'}
                        {entry.edited ? ' · Modified' : ''}
                      </small>
                    </div>
                    {entry.target && (
                      <button
                        role="switch"
                        aria-checked={Boolean(entry.enabled)}
                        aria-label={`Enable ${entry.id}`}
                        className={`toggle ${entry.enabled ? 'on' : ''}`}
                        disabled={busy}
                        onClick={() => void attempt(() => toggle(entry))}
                      >
                        <span />
                      </button>
                    )}
                  </div>
                  <div className="plugins-card-status">
                    <span>{entry.state || (entry.enabled ? 'Enabled' : 'Disabled')}</span>
                    {entry.pending && <span className="plugins-pending">Awaiting reload</span>}
                  </div>
                  {entry.error && <p className="plugins-card-error">{entry.error}</p>}
                  <div className="plugins-card-actions">
                    {entry.target && (
                      <button disabled={busy} onClick={() => void edit(entry)}>
                        Edit
                      </button>
                    )}
                    <button
                      disabled={busy}
                      className={entry.pending ? 'primary' : undefined}
                      title={
                        entry.pending ? 'Mount this file as it is now' : 'Load this file again'
                      }
                      onClick={() =>
                        void attempt(() => host.reload(entry.id, entry.target ?? 'main'))
                      }
                    >
                      Reload
                    </button>
                    {entry.shipped && (
                      <button
                        disabled={busy}
                        title="Put the copy this build shipped back"
                        onClick={() =>
                          void attempt(() => host.restore(entry.id, entry.target ?? 'renderer'))
                        }
                      >
                        Restore
                      </button>
                    )}
                    <button
                      disabled={busy}
                      onClick={() =>
                        void attempt(async () => {
                          await host.remove(entry.id, entry.target ?? 'main')
                          if (open && open.id === entry.id) setOpen(null)
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                </article>
              ))}
            </div>

            {open && (
              <section className="plugins-editor">
                <header>
                  <strong>{open.id}</strong>
                  <span>{open.target === 'renderer' ? 'frontend' : 'backend'}</span>
                  <button aria-label="Close editor" onClick={() => setOpen(null)}>
                    ×
                  </button>
                </header>
                <textarea
                  autoFocus
                  aria-label={`Code for ${open.id}`}
                  className="plugins-textarea"
                  spellCheck={false}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <div className="plugins-editor-actions">
                  <button
                    className="primary"
                    disabled={busy || draft === original}
                    onClick={() =>
                      void attempt(async () => {
                        await host.save(open.id, open.target ?? 'main', draft)
                        setOriginal(draft)
                      })
                    }
                  >
                    Save and reload
                  </button>
                  <button disabled={busy || draft === original} onClick={() => setDraft(original)}>
                    Revert
                  </button>
                </div>
                <p className="plugins-note">
                  A plugin is trusted code: it shares this window's reach and the services it asks
                  for. Saving here mounts the new code at once, so keep a copy of anything you may
                  want back.
                </p>
              </section>
            )}
          </div>
        )
      }

      ctx.effect(() =>
        panels.register({
          id: 'plugins',
          title: 'Plugins',
          icon,
          description: 'Manage and reload the plugins in your workspace.',
          component: Plugins,
        }),
      )
    },
  }
}
