'use strict'
// Durable chat history: one JSON file per conversation under
// userData/storage/chat.threads/<id>.json, so a conversation can be read,
// backed up, moved, or deleted on its own. The record is a tree with a selected
// branch (see chat-tree.js) plus the provider messages that produced each
// stored answer.
//
// The directory is the only source of truth: there is no separate index to
// drift. Reads are cached by file mtime and size so listing a long sidebar does
// not re-parse every conversation on each call.
const fs = require('node:fs')
const path = require('node:path')
const { normalizeThread, summarize } = require('./chat-tree.js')

// The envelope written to each file, so a future reader can migrate it.
const SCHEMA = 1
// A conversation id is a file name. Validate it the way the storage provider
// validates scopes, so nothing can escape the history directory.
const ID_RE = /^[\w-]{1,80}$/

class ChatHistory {
  constructor(directory) {
    this.directory = directory
    this.cache = new Map()
  }

  file(id) {
    if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('Invalid conversation id')
    return path.join(this.directory, `${id}.json`)
  }

  list() {
    const threads = []
    for (const entry of this._entries()) {
      try {
        const thread = this._read(entry.id, entry.stat)
        if (thread) threads.push(summarize(thread))
      } catch {
        // A conversation that cannot be read is left out of the list rather
        // than breaking the whole sidebar.
      }
    }
    return threads.sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
    )
  }

  get(id) {
    const thread = this._read(id)
    return thread ? structuredClone(thread) : null
  }

  save(thread) {
    const file = this.file(thread.id)
    const body = JSON.stringify({ schema: SCHEMA, thread }, null, 2)
    fs.mkdirSync(this.directory, { recursive: true })
    const temporary = `${file}.tmp`
    fs.writeFileSync(temporary, body)
    fs.renameSync(temporary, file)
    this.cache.set(thread.id, { thread, ...this._stamp(thread.id) })
  }

  delete(id) {
    fs.rmSync(this.file(id), { force: true })
    this.cache.delete(id)
  }

  // Imports conversations from the single-file store exactly once: a
  // conversation that already has a file is left alone, and a failure is
  // reported so the caller can retry instead of marking the import done.
  import(threads) {
    const imported = []
    const skipped = []
    const failed = []
    for (const thread of Array.isArray(threads) ? threads : []) {
      try {
        const file = this.file(thread?.id)
        if (fs.existsSync(file)) {
          skipped.push(thread.id)
          continue
        }
        this.save(normalizeThread(thread))
        imported.push(thread.id)
      } catch {
        failed.push(thread?.id)
      }
    }
    return { imported, skipped, failed }
  }

  _read(id, stat = this._stamp(id)) {
    if (!stat) return null
    const cached = this.cache.get(id)
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.thread
    const parsed = JSON.parse(fs.readFileSync(this.file(id), 'utf8'))
    const stored = parsed && typeof parsed === 'object' ? (parsed.thread ?? parsed) : null
    if (!stored || stored.id !== id) throw new Error(`Unreadable conversation file: ${id}`)
    const thread = normalizeThread(stored)
    this.cache.set(id, { thread, ...stat })
    return thread
  }

  _stamp(id) {
    try {
      const stat = fs.statSync(this.file(id))
      return { mtimeMs: stat.mtimeMs, size: stat.size }
    } catch {
      this.cache.delete(id)
      return null
    }
  }

  // Files that look like conversations. Anything else in the directory (a
  // leftover .tmp, notes the user dropped in) is ignored.
  _entries() {
    let names
    try {
      names = fs.readdirSync(this.directory, { withFileTypes: true })
    } catch {
      return []
    }
    const entries = []
    for (const name of names) {
      if (!name.isFile() || !name.name.endsWith('.json')) continue
      const id = name.name.slice(0, -'.json'.length)
      if (!ID_RE.test(id)) continue
      const stat = this._stamp(id)
      if (stat) entries.push({ id, stat })
    }
    return entries
  }
}

module.exports = { ChatHistory, SCHEMA }
