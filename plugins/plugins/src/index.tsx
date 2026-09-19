import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react'
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
 * Plugin studio: the panel that lists, edits, and reloads the plugins this app is
 * running.
 *
 * Loading them is the window's job, not a plugin's (`apps/frontend/src/host.ts`
 * owns the library and provides it), so this plugin only draws what the library
 * reports. That is what keeps the plugins the distribution shipped and the ones
 * written here on one list, with the same buttons.
 */
export function pluginsPlugin(runtime: RuntimeControl): AppPlugin {
  return {
    id: 'feature.plugins',
    name: 'Plugin studio',
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

      function Studio() {
        const snapshot = useSyncExternalStore(host.subscribe, host.getSnapshot)
        const waiting = snapshot.plugins.filter((entry) => entry.pending).length
        const [open, setOpen] = useState<PluginLibraryEntry | null>(null)
        const [draft, setDraft] = useState('')
        const [original, setOriginal] = useState('')
        const [adding, setAdding] = useState('')
        const [target, setTarget] = useState<'main' | 'renderer'>('main')
        const [busy, setBusy] = useState(false)
        const [notice, setNotice] = useState('')

        useEffect(() => {
          if (!open) return
          let alive = true
          setNotice('')
          host
            .read(open.id, open.target ?? 'main')
            .then((file) => {
              if (!alive) return
              setDraft(file.source)
              setOriginal(file.source)
            })
            .catch((error) => {
              if (alive) setNotice(readable(error))
            })
          return () => {
            alive = false
          }
        }, [open])

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

        async function create(event: FormEvent) {
          event.preventDefault()
          const id = adding.trim()
          if (!id) return
          await attempt(async () => {
            await host.create(id, target)
            setAdding('')
            setOpen({ id, target, file: '' })
          })
        }

        return (
          <div className="studio-panel">
            <div className="eyebrow">LOADED WHILE THE APP RUNS</div>
            <h2>
              Plugin studio
              <span className="studio-mark">
                <span
                  className="icon-mask"
                  style={{ maskImage: `url("${icon}")` }}
                  aria-hidden="true"
                />
              </span>
            </h2>
            <p className="studio-quiet">
              Edit a plugin’s source and reload it here. Open its folder to edit components,
              styles, or native code: a file changed there waits, marked changed, until it is
              reloaded. Failed edits keep the working version running.
            </p>

            <div className="studio-tools">
              <code className="studio-path" title={snapshot.folder}>
                {snapshot.folder || 'plugins folder unavailable'}
              </code>
              <button disabled={busy || !snapshot.folder} onClick={() => void host.reveal()}>
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
              <label
                className="studio-switch"
                title="Notice edits made outside the app and report them on their rows"
              >
                <input
                  type="checkbox"
                  checked={snapshot.watching}
                  onChange={(event) => void attempt(() => host.setWatching(event.target.checked))}
                />
                Watch for changes
              </label>
              <label
                className="studio-switch"
                title="Apply a noticed change on the spot instead of waiting for Reload"
              >
                <input
                  type="checkbox"
                  checked={snapshot.reloadOnSave}
                  onChange={(event) =>
                    void attempt(() => host.setReloadOnSave(event.target.checked))
                  }
                />
                Reload on save
              </label>
            </div>

            {(notice || snapshot.error) && (
              <p role="alert" className="studio-error">
                {notice || snapshot.error}
              </p>
            )}
            {snapshot.loading && <p className="studio-quiet">Reading plugin files…</p>}

            <div className="section-label">
              PLUGINS <span>{snapshot.plugins.length}</span>
            </div>
            {!snapshot.loading && snapshot.plugins.length === 0 && (
              <p className="studio-quiet">No plugin files yet. Create the first one below.</p>
            )}
            {snapshot.plugins.map((entry) => (
              <div
                className={`studio-row ${
                  open && open.id === entry.id && open.target === entry.target ? 'selected' : ''
                }`}
                key={`${entry.id}:${entry.target}`}
              >
                <div className="studio-meta">
                  <strong>{entry.id}</strong>
                  <small>
                    {entry.target === 'renderer'
                      ? 'renderer'
                      : entry.target === 'main'
                        ? 'main process'
                        : 'unusable file name'}
                    {entry.shipped ? (entry.edited ? ' · shipped, edited' : ' · shipped') : ''}
                    {entry.pending ? <b className="studio-pending"> · file changed</b> : ''}
                    {entry.error ? ` · ${entry.error}` : entry.state ? ` · ${entry.state}` : ''}
                  </small>
                </div>
                <div className="studio-row-actions">
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
                  {entry.target && (
                    <button disabled={busy} onClick={() => setOpen(entry)}>
                      Edit
                    </button>
                  )}
                  <button
                    disabled={busy}
                    className={entry.pending ? 'primary' : undefined}
                    title={entry.pending ? 'Mount this file as it is now' : 'Load this file again'}
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
              </div>
            ))}

            <form className="studio-form" onSubmit={(event) => void create(event)}>
              <div className="section-label">NEW PLUGIN</div>
              <input
                aria-label="Plugin id"
                placeholder="user.notes"
                maxLength={60}
                value={adding}
                onChange={(event) => setAdding(event.target.value)}
              />
              <select
                aria-label="Where the plugin runs"
                value={target}
                onChange={(event) => setTarget(event.target.value as 'main' | 'renderer')}
              >
                <option value="main">Main process</option>
                <option value="renderer">Renderer</option>
              </select>
              <button className="primary" type="submit" disabled={busy || !adding.trim()}>
                Create
              </button>
            </form>

            {open && (
              <section className="studio-editor">
                <header>
                  <strong>{open.id}</strong>
                  <span>{open.target === 'renderer' ? 'renderer' : 'main process'}</span>
                  <button aria-label="Close editor" onClick={() => setOpen(null)}>
                    ×
                  </button>
                </header>
                <textarea
                  aria-label={`Code for ${open.id}`}
                  className="studio-textarea"
                  spellCheck={false}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <div className="studio-editor-actions">
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
                <p className="studio-note">
                  A plugin is trusted code: it shares this window's reach and the services it asks
                  for. Saving here mounts the new code at once, so keep a copy of anything you may
                  want back.
                </p>
              </section>
            )}

            <p className="studio-note">
              Every plugin this app runs is a file in this folder, including the ones this build
              shipped: those are marked <code>shipped</code>, editing one is allowed, and{' '}
              <strong>Restore</strong> puts the built copy back. Files are named{' '}
              <code>feature.name.renderer.js</code> for this window or{' '}
              <code>user.name.main.js</code> for the main process.
            </p>
          </div>
        )
      }

      ctx.effect(() =>
        panels.register({
          id: 'plugins',
          title: 'Plugin studio',
          icon,
          description: 'Add, edit, and reload plugins while the app runs.',
          component: Studio,
        }),
      )
    },
  }
}
