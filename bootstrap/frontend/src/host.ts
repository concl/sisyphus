import * as profile from '@sisyphus/profile'
import * as cordis from '@deepseek-ai/cordis'
import * as preferences from '@sisyphus/profile/preferences'
import * as react from 'react'
import * as reactDom from 'react-dom'
import * as reactDomClient from 'react-dom/client'
import * as jsx from 'react/jsx-runtime'
import * as sdk from '@sisyphus/sdk'
import {
  readable,
  services,
  type AppPlugin,
  type PluginLibrary,
  type PluginLibraryEntry,
  type PluginLibrarySnapshot,
  type RuntimeControl,
} from '@sisyphus/sdk'
import * as ui from '@sisyphus/ui'

/**
 * The plugin library: the window's half of the runtime plugin system.
 *
 * Plugins are not imported by this app; they are files on disk. That is what
 * makes `plugins/*` an artifact the distribution carries instead of a
 * choice made by the bundler, and it is what lets a plugin be added, edited,
 * reloaded, or removed while the app runs.
 *
 * Two kinds of file are loaded, by the contract each one uses:
 *   - a script, which calls `sisyphus.define({ id, plugin })`, gets the host API
 *     as its only parameter, and needs no build step at all;
 *   - an artifact, which is what `scripts/build-plugins.mjs` writes from a
 *     package: self-contained code that calls `SisyphusRuntime.register(id, module)`
 *     and takes React and the SDK from this window, so one React serves them all.
 * Both are mounted, reported, reloaded, and unmounted the same way.
 *
 * The window also answers `require` for the names the build keeps external, because
 * a dependency inside a plugin may ship as CommonJS and ask for React that way.
 *
 * The icon a plugin created from the studio gets, as a maskable data URI.
 */
export const PLUGIN_ICON =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath d=%22M10 2h4v3.2a3 3 0 0 1 0 5.6V14h4.8a3 3 0 0 1 5.2 0H24v4h-3.2a3 3 0 0 0-5.6 0H10v-4.8a3 3 0 0 1 0-5.2V2Z%22/%3E%3C/svg%3E'

/**
 * Where the blocks sit by default. The workspace plugin takes this as its fallback
 * arrangement; it is the app's own preference, not a plugin's, so it lives here.
 */
export const DEFAULT_LAYOUT: unknown[] = [
  { id: 'home' },
  { id: 'python-host', direction: 'right', reference: 'home', width: 420 },
  { id: 'terminal', direction: 'below', reference: 'home', height: 235 },
  { id: 'todo', direction: 'below', reference: 'python-host', height: 415 },
]

/** What a plugin file can reach. Files are plain scripts with no imports. */
export interface HostApi {
  define(definition: unknown): void
  react: typeof react
  sdk: typeof services
  icons: { plugin: string }
}

/** Everything a plugin file may reach, except the `define` call it uses itself. */
export const hostApi = (): Omit<HostApi, 'define'> => ({
  react,
  sdk: services,
  icons: { plugin: PLUGIN_ICON },
})

/** The globals a built artifact reads. */
interface RuntimeGlobals {
  cordis: typeof cordis
  react: typeof react
  jsx: typeof jsx
  reactDom: typeof reactDom
  reactDomClient: typeof reactDomClient
  sdk: typeof sdk
  profile: typeof profile
  preferences: typeof preferences
  ui: typeof ui
  /**
   * What a CommonJS dependency inside a plugin uses. The build leaves the names
   * below external, so a dependency that ships as CommonJS reaches one of them with
   * `require`; without an answer here it throws `require is not defined` while the
   * plugin is being loaded, and the whole plugin is lost.
   */
  require(name: string): unknown
  register(id: string, module: unknown): void
}

/**
 * Hands the window's React, SDK, and UI to the artifacts about to be evaluated.
 *
 * An artifact is built with those as external references, so this is the seam that
 * makes `import { useState } from 'react'` in a plugin and in this app the same
 * hook, rather than two copies of React in one page.
 */
export function installGlobals() {
  // One table, two doors: the names here are the ones the artifact build keeps
  // external, and both a bundle's global reference and a dependency's `require`
  // arrive at the same instance. One React per window is the point.
  const provided: Record<string, unknown> = {
    '@deepseek-ai/cordis': cordis,
    react,
    'react/jsx-runtime': jsx,
    'react-dom': reactDom,
    'react-dom/client': reactDomClient,
    '@sisyphus/sdk': sdk,
    '@sisyphus/profile': profile,
    '@sisyphus/profile/preferences': preferences,
    '@sisyphus/ui': ui,
  }
  const globals: RuntimeGlobals = {
    cordis,
    react,
    jsx,
    reactDom,
    reactDomClient,
    sdk,
    profile,
    preferences,
    ui,
    require(name: string) {
      if (name in provided) return provided[name]
      throw new Error(
        `A plugin asked for "${name}". The window only provides React, the profile, and the SDK.`,
      )
    },
    register() {
      throw new Error('No plugin is being loaded right now.')
    },
  }
  ;(globalThis as { SisyphusRuntime?: RuntimeGlobals }).SisyphusRuntime = globals
  ;(globalThis as { require?: unknown }).require = globals.require
  return globals
}

/**
 * Runs one plugin script and returns the plugin it defines.
 *
 * The file runs as the body of a function whose only parameter is `sisyphus`, so a
 * plugin can be added or edited while the app is running without a build step.
 * What it cannot reach through that object is out of scope by construction -
 * though a plugin is still trusted code once it is mounted, like a built one.
 */
export function evaluate(source: string, id: string, api = hostApi()): AppPlugin {
  const definitions: unknown[] = []
  const scope: HostApi = { ...api, define: (definition) => definitions.push(definition) }
  // The file is data the person wrote, run on purpose: no bundler is in the loop.
  new Function('sisyphus', source)(scope)
  if (definitions.length !== 1)
    throw new Error(
      definitions.length === 0
        ? `${id} must call sisyphus.define({ id, plugin })`
        : `${id} calls sisyphus.define ${definitions.length} times; define one plugin per file.`,
    )
  const definition = definitions[0] as { id?: string; name?: string; plugin?: AppPlugin } | null
  if (!definition || typeof definition !== 'object')
    throw new Error(`${id} defined a value that is not an object.`)
  if (definition.id !== id)
    throw new Error(`${id} defines the id "${definition.id}"; the file name is the id.`)
  const plugin = definition.plugin
  if (!plugin || typeof plugin.apply !== 'function')
    throw new Error(`${id} must define a plugin with an apply(context) function.`)
  return { ...plugin, id, name: definition.name ?? plugin.name ?? id }
}

/**
 * Runs one built artifact and returns the plugin it registered.
 *
 * The artifact is generated code, so it is handed the globals above instead of a
 * parameter; everything else is the same promise as a script gets: one plugin per
 * file, the file name is the id, and a failure says what is wrong.
 */
export function evaluateArtifact(
  source: string,
  id: string,
  meta: { export?: string; needs?: string[] },
  values: Record<string, unknown>,
): AppPlugin {
  const captured: unknown[] = []
  const globals = (globalThis as { SisyphusRuntime?: RuntimeGlobals }).SisyphusRuntime
  if (!globals) throw new Error('The plugin runtime is not installed.')
  const previous = globals.register
  globals.register = (registeredId, module) => {
    if (registeredId === id) captured.push(module)
  }
  try {
    new Function(source)()
  } catch (error) {
    throw new Error(`${id} could not be loaded: ${(error as Error).message}`, { cause: error })
  } finally {
    globals.register = previous
  }
  if (captured.length !== 1)
    throw new Error(
      captured.length === 0
        ? `${id} did not register a plugin; build it with scripts/build-plugins.mjs`
        : `${id} registered ${captured.length} plugins; one artifact is one plugin.`,
    )
  const module = captured[0] as Record<string, unknown>
  if (!module || typeof module !== 'object') throw new Error(`${id} is not a plugin module.`)
  let exported: unknown = meta.export ? module[meta.export] : undefined
  if (exported === undefined) {
    // A hand-written artifact may export the plugin under any single name.
    const candidates = Object.values(module).filter(
      (value) =>
        typeof value === 'function' ||
        (value !== null && typeof value === 'object' && 'apply' in (value as object)),
    )
    if (candidates.length === 1) exported = candidates[0]
  }
  if (exported === undefined)
    throw new Error(`${id} does not export "${meta.export ?? 'default'}".`)
  const plugin = (
    typeof exported === 'function'
      ? (exported as (...args: unknown[]) => AppPlugin)(
          ...(meta.needs ?? []).map((need) => values[need]),
        )
      : exported
  ) as AppPlugin
  if (!plugin || typeof plugin.apply !== 'function')
    throw new Error(`${id} exported something that is not a plugin with apply(context).`)
  return { ...plugin, id, name: plugin.name ?? id }
}

export interface LibraryDeps {
  runtime: RuntimeControl
  call<T>(method: string, input?: unknown): Promise<T>
  on<T>(event: string, listener: (value: T) => void): () => void
  /** What the workspace plugin uses as its default arrangement. */
  layout?: unknown[]
}

/** The catalog the native half reports: files on disk, plus what it knows of them. */
interface Catalog {
  folder: string
  watching: boolean
  reloadOnSave: boolean
  plugins: PluginLibraryEntry[]
}

/**
 * The plugins this window runs, read from the folder they live in.
 *
 * It keeps them in step with the disk: a file that appears is mounted, a file that
 * disappears is unmounted, and a file that changes is reported as pending and
 * mounted again when a reload asks for it - which is what Reload on save does by
 * itself. A file that fails to load leaves the code that already works in place.
 * A plugin's stylesheet is tied to its lifetime too, so switching a plugin off
 * takes its styles with it.
 */
export function createLibrary(deps: LibraryDeps): PluginLibrary {
  const listeners = new Set<() => void>()
  const mounted = new Set<string>()
  const failures = new Map<string, string>()
  const sources = new Map<string, string>()
  const versions = new Map<string, string>()
  // Files that are ahead of the code this window runs, by the version seen when the
  // change was noticed. Reloading one is the person's decision, so a change is
  // remembered rather than applied.
  const pending = new Map<string, string>()
  const styles = new Map<string, HTMLStyleElement>()
  let catalog: Catalog = { folder: '', watching: false, reloadOnSave: false, plugins: [] }
  let reloadOnSave = false
  let problem = ''
  let stopped = false
  let snapshot: PluginLibrarySnapshot = {
    loading: true,
    folder: '',
    watching: false,
    reloadOnSave: false,
    plugins: [],
  }
  let queue: Promise<void> = Promise.resolve()

  const setStyle = (id: string, css: string | undefined) => {
    // A test can run this without a document; nothing to show there anyway.
    if (typeof document === 'undefined') return
    const existing = styles.get(id)
    if (!css) {
      existing?.remove()
      styles.delete(id)
      return
    }
    const style = existing ?? document.createElement('style')
    if (style.textContent !== css) style.textContent = css
    if (!existing) {
      style.dataset.plugin = id
      document.head.append(style)
      styles.set(id, style)
    }
  }

  const publish = () => {
    const states = new Map(deps.runtime.list().map((plugin) => [plugin.id, plugin]))
    snapshot = {
      loading: false,
      folder: catalog.folder,
      watching: catalog.watching,
      reloadOnSave,
      error: problem || undefined,
      plugins: catalog.plugins.map((entry) => {
        if (entry.target !== 'renderer') return entry
        const state = states.get(entry.id)
        return {
          ...entry,
          enabled: state?.enabled,
          state: state?.state,
          pending: pending.has(entry.id),
          error: failures.get(entry.id) ?? entry.error,
        }
      }),
    }
    for (const listener of listeners) listener()
  }

  /**
   * Brings this process in line with the folder, one pass at a time. A save, a
   * button, and the native half's announcement can all arrive together, and two
   * passes at once would try to mount the same plugin twice.
   */
  function refresh({ reload = [] }: { reload?: string[] } = {}) {
    queue = queue.then(() => refreshOnce(reload)).catch(() => {})
    return queue
  }

  /** One pass: mount what is new, replace what changed, unmount what is gone. */
  async function refreshOnce(reload: string[]) {
    if (stopped) return
    try {
      catalog = await deps.call<Catalog>('plugins.catalog')
      reloadOnSave = catalog.reloadOnSave === true
      problem = ''
    } catch (error) {
      problem = readable(error)
      publish()
      return
    }
    // The composition order is the order the distribution built them in; a file
    // with no order is something added later, so it mounts after the rest.
    const files = catalog.plugins
      .filter((entry) => entry.target === 'renderer')
      .slice()
      .sort(
        (left, right) =>
          (left.order ?? 1000) - (right.order ?? 1000) || left.id.localeCompare(right.id),
      )
    for (const id of [...mounted]) {
      if (files.some((entry) => entry.id === id)) continue
      try {
        await deps.runtime.unmount(id)
      } catch (error) {
        // The plugin is still mounted, so remembering it as gone would leave it
        // running with nothing watching over it - and without its styles. A file
        // that disappeared before the profile heard about it is already gone, which
        // is the outcome we wanted.
        if (deps.runtime.list().some((plugin) => plugin.id === id)) {
          console.warn(`[plugins] could not unmount ${id}: ${readable(error)}`)
          continue
        }
      }
      mounted.delete(id)
      failures.delete(id)
      sources.delete(id)
      versions.delete(id)
      pending.delete(id)
      setStyle(id, undefined)
    }
    for (const entry of files) {
      if (stopped) return
      const known = mounted.has(entry.id)
      const wanted = reload.includes('*') || reload.includes(entry.id)
      try {
        // The initiating window and the backend's explicit reload event can both
        // request this version. Mount it once; backend reloads advance the version.
        if (entry.version && versions.get(entry.id) === entry.version) continue
        // Already known to be ahead of the running code, and still the same file: the
        // catalog can report that without reading a build that may be megabytes wide.
        if (!wanted && entry.version && pending.get(entry.id) === entry.version) continue
        const read = await deps.call<{ source: string; css?: string }>('plugins.render', {
          id: entry.id,
          target: 'renderer',
        })
        const key = `${read.source}\u0000${read.css ?? ''}`
        if (!wanted && sources.get(entry.id) === key) {
          // Unchanged. Its stylesheet is still checked, because it is the one thing
          // a plugin needs that is not visible in the code: a missing style element
          // means an unstyled plugin that otherwise reports itself healthy.
          pending.delete(entry.id)
          setStyle(entry.id, read.css)
          continue
        }
        // The file changed. Mounting it again is a decision, and it is taken by a
        // reload: an edit that arrived from outside the app waits here, with the
        // code that works still running underneath it.
        if (known && !wanted && !reloadOnSave) {
          pending.set(entry.id, entry.version ?? '')
          continue
        }
        const artifact = Boolean(entry.export) || read.source.includes('SisyphusRuntime.register')
        const plugin = artifact
          ? evaluateArtifact(read.source, entry.id, entry, {
              runtime: deps.runtime,
              layout: deps.layout ?? DEFAULT_LAYOUT,
            })
          : evaluate(read.source, entry.id)
        if (known) await deps.runtime.replace(entry.id, plugin)
        else await deps.runtime.add({ id: entry.id, plugin })
        mounted.add(entry.id)
        sources.set(entry.id, key)
        if (entry.version) versions.set(entry.id, entry.version)
        pending.delete(entry.id)
        failures.delete(entry.id)
        setStyle(entry.id, read.css)
      } catch (error) {
        const reason = readable(error)
        failures.set(entry.id, reason)
        console.warn(`[plugins] ${entry.id}: ${reason}`)
      }
    }
    publish()
  }

  // A failed action is reported twice on purpose: in the snapshot, so any panel
  // drawing this library can show it, and to the caller, so a button can react.
  async function run(work: () => Promise<unknown>, reload: string[] = []) {
    try {
      await work()
      problem = ''
    } catch (error) {
      problem = readable(error)
      publish()
      throw new Error(problem, { cause: error })
    }
    await refresh({ reload })
  }

  // Following the folder cannot wait for a panel: a plugin has to mount whether or
  // not the block that edits plugins happens to be on screen.
  const offEvent = deps.on<{ reload?: string[] }>('plugins.changed', (event) =>
    void refresh({ reload: event.reload ?? [] }),
  )
  const offRuntime = deps.runtime.subscribe(() => publish())
  void refresh()

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    refresh: () => refresh(),
    read: (id, target) =>
      deps.call<{ source: string; file: string; css?: string }>('plugins.read', { id, target }),
    save: (id, target, source) =>
      run(() => deps.call('plugins.write', { id, target, source }), [id]),
    create: (id, target) => run(() => deps.call('plugins.create', { id, target }), [id]),
    remove: (id, target) => run(() => deps.call('plugins.remove', { id, target })),
    async reload(id, target) {
      await run(() => deps.call('plugins.reload', { id }), target === 'renderer' ? [id] : [])
    },
    reloadAll: () =>
      run(async () => {
        await deps.call('plugins.reload', {})
        await refresh({ reload: ['*'] })
      }),
    restore: (id, target) => run(() => deps.call('plugins.restore', { id, target }), [id]),
    setWatching: (watching) => run(() => deps.call('plugins.watch', { watching })),
    setReloadOnSave: (next) =>
      // Turning it on applies what is already waiting, so the switch means what it
      // says instead of taking effect at the next save.
      run(() => deps.call('plugins.reloadOnSave', { reloadOnSave: next }), next ? ['*'] : []),
    async reveal(id, target) {
      try {
        await deps.call('plugins.reveal', id ? { id, target } : {})
        problem = ''
      } catch (error) {
        problem = readable(error)
        publish()
      }
    },
    // The renderer goes away with the window; this keeps hot reload and tests honest.
    dispose() {
      stopped = true
      offEvent()
      offRuntime()
      for (const id of [...styles.keys()]) setStyle(id, undefined)
      listeners.clear()
    },
  }
}
