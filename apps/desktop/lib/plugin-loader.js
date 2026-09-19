'use strict'
// Plugin files that can be added, edited, and removed while the app is running.
//
// The composition profiles (`apps/desktop/profile.js`, `apps/frontend/src/profile.ts`)
// are build-time choices. This is the runtime half: a folder of plugin files that
// is read on demand. The import URL carries the file's modification time, so
// loading a file again after an edit runs the new code, because Node caches a
// module per URL and a new URL is a new module.
//
// The file name is the contract:
//   user.<name>.main.js      a main-process plugin, ES module
//   user.<name>.main.cjs     a main-process plugin, CommonJS
//   user.<name>.renderer.js  a renderer plugin, evaluated by the renderer host
// The id is the file name without its suffix, so runtime plugins live in their
// own `user.` namespace and can never collide with a composed plugin.
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const compiler = require('./plugin-compiler')

const TARGETS = [
  { suffix: '.main.js', target: 'main', format: 'esm', label: 'main process' },
  { suffix: '.main.cjs', target: 'main', format: 'cjs', label: 'main process' },
  { suffix: '.renderer.js', target: 'renderer', format: 'esm', label: 'renderer' },
]
// A plugin id is a namespace and a name, so `feature.chat` is the artifact this
// build shipped and `user.notes` is one the person wrote. The two are the same kind
// of thing to the loader, the catalog, and the studio.
const ID_RE = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/
const PACKAGE = '{ "type": "module" }\n'
const DEBOUNCE_MS = 250

/** Reads a plugin file name. Returns null for files that are not plugin files. */
function parseName(name) {
  const kind = TARGETS.find((entry) => name.endsWith(entry.suffix))
  if (!kind) return null
  const id = name.slice(0, -kind.suffix.length)
  if (!ID_RE.test(id))
    return {
      id: name,
      target: null,
      error: `Plugin files are named <namespace>.<name> with a .main.js, .main.cjs, or .renderer.js suffix: ${name}`,
    }
  return { id, target: kind.target, format: kind.format, label: kind.label }
}

/** Checks a value a plugin file exported, and explains what is wrong with it. */
function validate(id, exported) {
  if (typeof exported === 'function') return { name: id, apply: exported }
  if (!exported || typeof exported !== 'object')
    return { error: `${id} must export a plugin object or a function.` }
  if (exported.id && exported.id !== id)
    return { error: `${id} exports the id "${exported.id}"; the file name is the id.` }
  if (typeof exported.apply !== 'function')
    return { error: `${id} must export a plugin with an apply(context) function.` }
  if (
    exported.inject !== undefined &&
    typeof exported.inject !== 'string' &&
    !Array.isArray(exported.inject) &&
    typeof exported.inject !== 'object'
  )
    return { error: `${id} has an inject value that is not a service name or list.` }
  return exported
}

function scaffold(id, target) {
  if (target === 'renderer')
    return `// ${id} — a renderer plugin, loaded while the app runs.
// This file is a plain script, not a module: it has no imports, and the only
// thing it can reach beyond the browser is \`sisyphus\`. Reload it and the new
// code replaces the old one; the workspace stays up either way.
sisyphus.define({
  id: '${id}',
  name: '${id}',
  plugin: {
    inject: [sisyphus.sdk.panels],
    apply(ctx) {
      const panels = ctx.get(sisyphus.sdk.panels)
      const h = sisyphus.react.createElement
      const Panel = () => h('div', { className: 'quiet-note' }, 'Hello from ${id}.')
      ctx.effect(() =>
        panels.register({
          id: '${id}',
          title: '${id}',
          description: 'A block added at runtime.',
          icon: sisyphus.icons.plugin,
          component: Panel,
        }),
      )
    },
  },
})
`
  return `// ${id} — a main-process plugin, loaded while the app is running.
// It exports a Cordis plugin and takes what it needs from the context: services
// are contracts, so this stays valid however the app is composed.
export default {
  name: '${id}',
  inject: ['transport.v1'],
  apply(ctx) {
    const transport = ctx.get('transport.v1')
    // The renderer reaches this with desktop.call('${id}.ping').
    ctx.effect(() => transport.handle('${id}.ping', () => ({ from: '${id}', at: Date.now() })))
  },
}
`
}

/** A folder of plugin files. Pure Node: the Electron plugin supplies the directory. */
class PluginLoader {
  constructor(directory, { manifest = null, options = {} } = {}) {
    this.directory = directory
    this.watcher = null
    this.timer = null
    this.versions = new Map()
    // What the shipped build knows about a file: the order it mounts in, which
    // export holds the plugin, and what it needs. A hand-written file has none of
    // this and is loaded by its own contract instead.
    this.manifest = manifest
    this.options = options
    this.compiled = new Map()
    this.errors = new Map()
    this.packageEntries = new Map()
  }

  /** The build's description of a plugin id, when this build shipped it. */
  meta(id) {
    return this.manifest?.plugins.find((plugin) => plugin.id === id)
  }

  /** Creates the folder and makes its .js files ES modules, so `export default` is valid. */
  ensure() {
    fs.mkdirSync(this.directory, { recursive: true })
    const manifest = path.join(this.directory, 'package.json')
    if (!fs.existsSync(manifest)) fs.writeFileSync(manifest, PACKAGE)
  }

  /**
   * Every plugin file in the folder. A file whose name is not a plugin name, or
   * whose id is claimed twice, is reported with a null target and an error
   * instead of being loaded.
   */
  scan() {
    let names
    try {
      names = fs.readdirSync(this.directory)
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
    const sourceEntries = compiler.packages(this.directory).flatMap(entry => {
      if (!entry.target && entry.error && this.packageEntries.has(entry.folder))
        return this.packageEntries.get(entry.folder).map(previous => ({ ...previous, error: entry.error }))
      return [entry]
    })
    for (const folder of new Set(sourceEntries.filter(entry => !entry.error).map(entry => entry.folder)))
      this.packageEntries.set(folder, sourceEntries.filter(entry => entry.folder === folder))
    const entries = sourceEntries.map(entry => ({ ...entry,
      shipped: Boolean(this.meta(entry.id)), error: entry.error ?? this.errors.get(entry.id) }))
    const claimed = new Set(entries.map(entry => `${entry.id}:${entry.target}`))
    for (const name of names) {
      const parsed = parseName(name)
      if (!parsed) continue
      // A source package supersedes its legacy flat artifact.
      if (entries.some(entry => entry.format === 'source' && entry.id === parsed.id && entry.target === parsed.target)) continue
      const file = path.join(this.directory, name)
      let mtime
      try {
        mtime = fs.statSync(file).mtimeMs
      } catch {
        continue
      }
      const key = `${parsed.id}:${parsed.target}`
      if (parsed.target && claimed.has(key)) {
        entries.push({
          ...parsed,
          target: null,
          file,
          mtime,
          error: `${parsed.id} is claimed twice.`,
        })
        continue
      }
      claimed.add(key)
      const meta = parsed.target === 'renderer' ? this.meta(parsed.id) : undefined
      const styles = meta?.css ? path.join(this.directory, meta.css) : null
      // A change to a plugin's stylesheet is a change to the plugin, so the
      // timestamp a reload compares covers both files.
      const styleMtime = styles && fs.existsSync(styles) ? fs.statSync(styles).mtimeMs : 0
      entries.push({
        ...parsed,
        file,
        mtime: Math.max(mtime, styleMtime),
        order: meta?.order,
        export: meta?.export,
        needs: meta?.needs,
        css: styleMtime ? meta.css : (meta?.css ?? null),
        shipped: Boolean(meta),
      })
    }
    return entries.sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000) || a.id.localeCompare(b.id))
  }

  entry(id, target = 'main') {
    return this.scan().find((item) => item.id === id && item.target === target)
  }

  /** The file's text, for editing in the app, and its stylesheet when it has one. */
  read(id, target = 'main') {
    const entry = this.entry(id, target)
    if (!entry) throw new Error(`Unknown plugin: ${id}`)
    const css = entry.css ? path.join(this.directory, entry.css) : null
    return {
      source: fs.readFileSync(entry.file, 'utf8'),
      css: css && fs.existsSync(css) ? fs.readFileSync(css, 'utf8') : undefined,
      file: entry.file,
    }
  }

  /** Writes a plugin file atomically, so a watcher never sees half a file. */
  write(id, target, source) {
    if (typeof source !== 'string' || !source.trim())
      throw new Error('A plugin file needs some code.')
    if (!ID_RE.test(id))
      throw new Error(
        'Plugin ids look like feature.chat or user.notes, in lowercase letters, digits, or dashes.',
      )
    if (!TARGETS.some((kind) => kind.target === target))
      throw new Error(`Unknown plugin target: ${target}`)
    this.ensure()
    const suffix = target === 'renderer' ? '.renderer.js' : '.main.js'
    const file = this.entry(id, target)?.file ?? path.join(this.directory, `${id}${suffix}`)
    const temporary = `${file}.tmp`
    fs.writeFileSync(temporary, source)
    fs.renameSync(temporary, file)
    this.versions.set(id, (this.versions.get(id) ?? 0) + 1)
    return { file }
  }

  /** Creates a new plugin file with a working example. Never overwrites. */
  create(id, target) {
    if (
      this.entry(id, target) ||
      this.scan().some((item) => item.id === id && item.target === null)
    )
      throw new Error(`${id} already exists.`)
    const { file } = this.write(id, target, scaffold(id, target))
    return { file }
  }

  remove(id, target) {
    for (const entry of this.scan()) {
      if (entry.id !== id || (target && entry.target !== target)) continue
      if (entry.format === 'source') {
        const manifest = path.join(entry.folder, 'package.json')
        const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'))
        if (entry.target === 'renderer') delete pkg.sisyphus.entry
        else pkg.sisyphus.native = pkg.sisyphus.native.filter(item => item.id !== id)
        fs.writeFileSync(manifest, JSON.stringify(pkg, null, 2))
      } else fs.rmSync(entry.file, { force: true })
    }
    this.versions.delete(id)
  }

  /**
   * Loads one plugin file. The version in the URL makes this a fresh module even
   * when the file was written within the same millisecond as the last load.
   */
  async load(id, target = 'main') {
    const entry = this.entry(id, target)
    if (!entry) throw new Error(`Unknown plugin: ${id}`)
    if (!entry.target) throw new Error(entry.error)
    if (entry.format === 'source') {
      const built = await compiler.compile(entry)
      const plugin = validate(id, compiler.evaluateNative(entry, built.source, this.options))
      if (plugin.error) throw new Error(plugin.error)
      return { ...plugin, id }
    }
    const version = `${entry.mtime}.${this.versions.get(id) ?? 0}`
    const url = `${pathToFileURL(entry.file).href}?v=${version}`
    let module
    try {
      if (entry.format === 'cjs') delete require.cache[require.resolve(entry.file)]
      module = await import(url)
    } catch (error) {
      throw new Error(`${id} could not be loaded: ${error.message}`)
    }
    const exported = validate(id, module.default ?? module.plugin ?? module)
    if (exported.error) throw new Error(exported.error)
    return { ...exported, id, file: entry.file }
  }

  /** Loads every plugin for one process, keeping failures per file. */
  async loadAll(target = 'main') {
    const results = []
    for (const entry of this.scan()) {
      if (entry.target !== target) continue
      try {
        results.push({ id: entry.id, plugin: await this.load(entry.id, target) })
      } catch (error) {
        results.push({ id: entry.id, error: error.message })
      }
    }
    return results
  }

  /**
   * Makes the next load of a file a fresh module even though its timestamp is
   * unchanged. A manual reload means "run the file as it is now", and a change
   * that lands in the same millisecond as the last load is a real possibility
   * when a script or another process writes the file.
   */
  stale(id) {
    this.versions.set(id, (this.versions.get(id) ?? 0) + 1)
    this.compiled.delete(id)
  }

  async prepare() {
    for (const entry of this.scan()) {
      if (entry.format !== 'source' || entry.target !== 'renderer') continue
      if (entry.error && !this.errors.has(entry.id)) continue
      if (this.compiled.get(entry.id)?.mtime === entry.mtime) continue
      try {
        const built = await compiler.compile(entry)
        this.compiled.set(entry.id, { ...built, mtime: entry.mtime })
        this.errors.delete(entry.id)
      } catch (error) { this.errors.set(entry.id, error.message) }
    }
  }

  render(id) {
    if (this.errors.has(id)) throw new Error(this.errors.get(id))
    return this.compiled.get(id) ?? this.read(id, 'renderer')
  }

  /**
   * Watches the folder for saves. Best effort: some platforms and network folders
   * deliver no events for a directory, which is why every reload also has a
   * manual path. Returns false when the folder cannot be watched.
   */
  watch(onChange) {
    this.stop()
    try {
      this.watcher = fs.watch(this.directory, { persistent: false, recursive: true }, () => {
        clearTimeout(this.timer)
        this.timer = setTimeout(() => {
          this.timer = null
          onChange()
        }, DEBOUNCE_MS)
      })
    } catch {
      this.watcher = null
      return false
    }
    return true
  }

  stop() {
    clearTimeout(this.timer)
    this.timer = null
    this.watcher?.close()
    this.watcher = null
  }
}

module.exports = { DEBOUNCE_MS, ID_RE, PluginLoader, TARGETS, parseName, scaffold, validate }
