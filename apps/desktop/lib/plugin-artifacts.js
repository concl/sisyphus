'use strict'
// The plugins a distribution ships, and how they become the user's own files.
//
// `scripts/build-plugins.mjs` turns `packages/plugin-*` into artifacts. A distributed
// app carries that build next to itself, and this copies what it finds into the
// user's plugins folder, so from then on a shipped plugin is an ordinary plugin
// file: the app reads it, watches it, reloads it, and lets it be edited exactly like
// one the user wrote. That copy is the whole point - a plugin that can only be
// replaced by rebuilding the app is the thing this is here to stop being true.
//
// The record of what was copied (`.shipped.json`) is what makes `Restore` possible
// and what lets a sync remove its own leftovers without touching a user's files.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const MANIFEST = 'manifest.json'
const RECORD = '.shipped.json'

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** Whether a plugin file name is part of the shipped build, and not one of ours. */
const isRecord = (name) => name === RECORD || name === 'package.json'

class PluginArtifacts {
  constructor({ shippedDir, directory }) {
    this.shippedDir = shippedDir
    this.directory = directory
  }

  /** False when this build carries no plugins at all, which is not an error. */
  get available() {
    return Boolean(this.shippedDir) && fs.existsSync(path.join(this.shippedDir, MANIFEST))
  }

  manifest() {
    return readJson(path.join(this.shippedDir, MANIFEST), { plugins: [] })
  }

  /** What the build says about one plugin, or undefined for a file it did not build. */
  entry(id) {
    return this.manifest().plugins.find((plugin) => plugin.id === id)
  }

  ids() {
    return this.manifest().plugins.map((plugin) => plugin.id)
  }

  /** Every file the shipped build carries, earliest to mount first. */
  files() {
    const names = [MANIFEST]
    for (const plugin of this.manifest().plugins)
      for (const name of [...(plugin.files ?? []).map(file => file.name), plugin.js, plugin.css]) if (name) names.push(name)
    return [...new Set(names)]
  }

  /** The hash the build recorded, which is how an edit is told apart from a copy. */
  shippedSha(name) {
    if (name === MANIFEST) return null
    for (const plugin of this.manifest().plugins) {
      const file = (plugin.files ?? []).find((item) => item.name === name)
      if (file) return file.sha256
    }
    return null
  }

  /** What this folder has already taken from the build: name to the hash we wrote. */
  record() {
    return readJson(path.join(this.directory, RECORD), {}).files ?? {}
  }

  /** True when a shipped file is missing here or no longer matches what was built. */
  edited(name) {
    const shipped = this.shippedSha(name)
    if (!shipped) return false
    const dest = path.join(this.directory, name)
    if (!fs.existsSync(dest)) return true
    return sha256(dest) !== shipped
  }

  /** Status of every plugin file, for a panel that wants to say where it came from. */
  status() {
    const result = {}
    for (const name of this.files()) {
      if (isRecord(name)) continue
      result[name] = { edited: this.edited(name) }
    }
    return result
  }

  /** Copies one file, refusing to overwrite a user's edit unless told to. */
  copy(name, { force = false } = {}) {
    const source = path.join(this.shippedDir, name)
    if (!fs.existsSync(source)) return false
    const dest = path.join(this.directory, name)
    if (fs.existsSync(dest) && !force && name !== MANIFEST) {
      const shipped = this.shippedSha(name)
      if (shipped && sha256(dest) !== shipped) return false
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(source, dest)
    return true
  }

  save(files) {
    fs.mkdirSync(this.directory, { recursive: true })
    fs.writeFileSync(path.join(this.directory, RECORD), `${JSON.stringify({ files }, null, 2)}\n`)
  }

  /**
   * Brings the folder in line with the shipped build: add what is missing, refresh
   * what nobody edited, refresh the build's own record, leave edits in place, and
   * take back the files this build no longer carries.
   */
  seed({ force = false } = {}) {
    if (!this.available) return { seeded: [], kept: [], removed: [], available: false }
    const record = this.record()
    const shipped = this.files()
    const seeded = []
    const kept = []
    for (const name of shipped) {
      const dest = path.join(this.directory, name)
      const stale =
        record[name] !== undefined && fs.existsSync(dest) && sha256(dest) === record[name]
      if (fs.existsSync(dest) && !force && !stale && name !== MANIFEST) {
        kept.push(name)
        continue
      }
      if (this.copy(name, { force: force || stale })) {
        record[name] = sha256(path.join(this.directory, name))
        seeded.push(name)
      }
    }
    const removed = []
    for (const name of Object.keys(record)) {
      if (shipped.includes(name)) continue
      const dest = path.join(this.directory, name)
      const untouched = !fs.existsSync(dest) || sha256(dest) === record[name]
      if (untouched) fs.rmSync(dest, { force: true })
      if (untouched) {
        delete record[name]
        removed.push(name)
      }
    }
    this.save(record)
    return { seeded, kept, removed, available: true }
  }

  /** Puts the shipped copy of one plugin back, whatever happened to the local one. */
  restore(id) {
    const entry = this.entry(id)
    if (!entry) throw new Error(`${id} is not a plugin this build shipped.`)
    const record = this.record()
    const restored = []
    for (const name of [...new Set([...(entry.files ?? []).map(file => file.name), entry.js, entry.css].filter(Boolean))]) {
      if (this.copy(name, { force: true })) {
        record[name] = sha256(path.join(this.directory, name))
        restored.push(name)
      }
    }
    this.save(record)
    return restored
  }
}

module.exports = { MANIFEST, PluginArtifacts, RECORD }
