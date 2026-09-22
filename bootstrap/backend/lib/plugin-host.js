'use strict'
// The engine behind runtime plugin editing, in both directions: the `plugins.*`
// methods Plugin studio calls, and the `plugin_*` tools the chat agent calls.
//
// It takes a PluginLoader and the profile it mounts into, so the whole thing is
// pure Node and testable without Electron. One engine means a plugin the model
// writes is mounted, reported, and reloaded exactly like one typed by hand.
// A plugin file is text the app writes, and a build of one is not small: the chat
// plugin's artifact is over 2 MB because it carries its own dependencies. The limit
// is here to refuse an absurd payload, not to make a real artifact unsaveable.
//
// Nothing here is mounted because it appeared. Watching the folder tells this host
// which files differ from the code it is running; mounting them again is an
// explicit act, and `reloadOnSave` hands that act to the watcher.
const MAX_SOURCE = 8 * 1024 * 1024

const message = (error) => (error instanceof Error ? error.message : String(error))

const checkId = (value) => {
  if (typeof value !== 'string' || value.length > 100) throw new Error('Invalid plugin id')
  return value
}

const checkTarget = (value) => {
  if (value !== 'main' && value !== 'renderer') throw new Error('Unknown plugin target')
  return value
}

const checkSource = (value) => {
  if (typeof value !== 'string' || value.length > MAX_SOURCE)
    throw new Error('A plugin file must be text under 8 MB.')
  return value
}

class PluginHost {
  constructor({ loader, runtime, artifacts = null, watching = true, reloadOnSave = false }) {
    this.loader = loader
    this.runtime = runtime
    // The shipped build, when this app carries one: what a file came from, and how
    // to put a shipped plugin back after an edit.
    this.artifacts = artifacts
    // Watching notices a change; reloadOnSave applies it. Off is the default: a
    // save in an editor should not replace the code a terminal or a chat run is
    // using until the person asks for it.
    this.watching = watching
    this.reloadOnSave = reloadOnSave
    // The main-process plugins this folder put into the profile, and why the
    // ones that are not there failed.
    this.mounted = new Map()
    this.failures = new Map()
    this.closed = false
    this.queue = Promise.resolve()
  }

  /** The profile's own view of a plugin, for the ones that are not ours to run. */
  status(id) {
    return this.runtime.list().find((plugin) => plugin.id === id)
  }

  /**
   * True when the file on disk is not the code this process is running. The main
   * process answers for itself; a renderer file is judged by the window, which
   * knows what it mounted, so its entries carry no answer from here.
   */
  pending(entry) {
    const known = this.mounted.get(entry.id)
    return Boolean(known && known.mtime !== entry.mtime)
  }

  /**
   * Every plugin file in the folder, with what is known about it. This is what
   * both the studio and the agent's `plugin_list` read, so the two never
   * disagree about the folder.
   */
  catalog() {
    return {
      folder: this.loader.directory,
      watching: this.watching,
      reloadOnSave: this.reloadOnSave,
      plugins: this.loader.scan().map((entry) => ({
        id: entry.id,
        target: entry.target,
        file: entry.file,
        order: entry.order,
        export: entry.export,
        needs: entry.needs,
        css: entry.css ?? (this.loader.compiled.get(entry.id)?.css ? `${entry.id}.css` : null),
        version: `${entry.mtime}:${this.loader.versions.get(entry.id) ?? 0}`,
        pending: entry.target === 'main' ? this.pending(entry) : undefined,
        shipped: entry.shipped ?? false,
        edited: entry.shipped ? this.artifacts?.edited(require('node:path').relative(this.loader.directory, entry.file)) : undefined,
        error: entry.error ?? this.failures.get(entry.id),
        enabled: entry.target === 'main' ? this.status(entry.id)?.enabled : undefined,
        state: entry.target === 'main' ? this.status(entry.id)?.state : undefined,
      })),
    }
  }

  /**
   * Brings the mounted set in line with the folder: mount what is new, replace
   * what changed or was asked for, unmount what is gone. A file that fails to
   * load leaves the code that already works mounted, and the reason is kept for
   * the report. A file that changed on disk waits: it is reported as pending and
   * mounted again when a reload names it, or on the spot when this app reloads
   * on save.
   */
  sync(options = {}) {
    const operation = this.queue.then(() => this.syncOnce(options))
    this.queue = operation.catch(() => {})
    return operation
  }

  async syncOnce({ reload = [] } = {}) {
    if (this.closed) return
    await this.loader.prepare()
    const entries = this.loader.scan().filter((entry) => entry.target === 'main')
    const present = new Set(entries.map((entry) => entry.id))
    for (const id of [...this.mounted.keys()]) {
      if (present.has(id)) continue
      this.mounted.delete(id)
      if (this.status(id)) await this.runtime.unmount(id).catch(() => {})
    }
    for (const entry of entries) {
      if (this.closed) return
      const known = this.mounted.get(entry.id)
      const wanted = reload.includes('*') || reload.includes(entry.id)
      if (known && entry.restart) {
        if (known.mtime !== entry.mtime) this.failures.set(entry.id, 'Restart the app to reload the Electron platform bridge.')
        continue
      }
      if (known && !wanted && known.mtime === entry.mtime) continue
      // What was noticed is not what is applied. The code that works stays
      // mounted, and the catalog says the file is ahead of it.
      if (known && !wanted && !this.reloadOnSave) continue
      if (!known && this.status(entry.id)) {
        this.failures.set(entry.id, `${entry.id} is already a plugin of this app.`)
        continue
      }
      try {
        const plugin = await this.loader.load(entry.id)
        if (known) await this.runtime.replace(entry.id, plugin)
        else await this.runtime.add({ id: entry.id, plugin })
        this.mounted.set(entry.id, { mtime: entry.mtime, plugin })
        this.failures.delete(entry.id)
      } catch (error) {
        this.failures.set(entry.id, message(error))
      }
    }
  }

  /**
   * One file's text, for editing in the app or reading by the agent, with the
   * stylesheet that belongs to it. A renderer loads both to mount the plugin.
   */
  read(id, target = 'main') {
    const file = this.loader.read(id, target)
    return { id, target, source: file.source, css: file.css, file: file.file }
  }

  /** Replaces a file and mounts the new code. A renderer file mounts in the window. */
  async write(id, target, source) {
    this.loader.write(id, target, source)
    await this.sync({ reload: [id] })
  }

  /** A new file with a working example. Never overwrites one that exists. */
  async create(id, target) {
    this.loader.create(id, target)
    if (target === 'main') await this.sync({ reload: [id] })
  }

  /** Deletes the file and unmounts it. Nothing outside this folder is touched. */
  async remove(id, target) {
    if (this.loader.entry(id, target)?.restart) throw new Error('The Electron platform bridge is required by the app.')
    this.loader.remove(id, target)
    this.failures.delete(id)
    await this.sync()
  }

  /** Loads files again from disk, all of them or one, whether or not they changed. */
  async reload(id) {
    if (!id) {
      for (const entry of this.loader.scan()) this.loader.stale(entry.id)
      return this.sync({ reload: ['*'] })
    }
    this.failures.delete(id)
    this.loader.stale(id)
    await this.sync({ reload: [id] })
  }

  /**
   * Puts the shipped copy of a plugin back. A shipped plugin is an ordinary file
   * here, so editing it is allowed and this is the way back.
   */
  async restore(id, target = 'renderer') {
    if (!this.artifacts?.available)
      throw new Error('This app was not built with plugins to restore.')
    const files = this.artifacts.restore(id)
    this.loader.stale(id)
    await this.sync({ reload: [id] })
    return { id, restored: files }
  }

  /** Unmounts everything this folder added and stops watching it. */
  async close() {
    this.closed = true
    this.loader.stop()
    await this.queue
    for (const id of [...this.mounted.keys()]) {
      this.mounted.delete(id)
      await this.runtime.unmount(id).catch(() => {})
    }
  }
}

module.exports = { MAX_SOURCE, PluginHost, checkId, checkSource, checkTarget }
