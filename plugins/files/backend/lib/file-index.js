'use strict'
// Directory index for @-mentions in the composer. Metadata only — nothing is
// read — and results are cached briefly so typing stays responsive.
const fs = require('node:fs/promises')
const path = require('node:path')
const { validateFolder } = require('@sisyphus/native/folder')

const SKIP = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.venv',
  'venv',
  '__pycache__',
  'coverage',
  '.cache',
  '.pytest_cache',
  '.mypy_cache',
  'target',
  '.gradle',
])
const MAX_DEPTH = 8
const MAX_ENTRIES = 5000
const TTL = 15000

async function walk(root) {
  const entries = []
  const queue = [{ dir: root, depth: 0 }]
  while (queue.length && entries.length < MAX_ENTRIES) {
    const { dir, depth } = queue.shift()
    let children
    try {
      children = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const child of children) {
      if (entries.length >= MAX_ENTRIES) break
      if (child.name.startsWith('.') && child.name !== '.env.example') continue
      if (SKIP.has(child.name)) continue
      const absolute = path.join(dir, child.name)
      const relative = path.relative(root, absolute).split(path.sep).join('/')
      const folder = child.isDirectory()
      entries.push({ path: folder ? `${relative}/` : relative, type: folder ? 'folder' : 'file' })
      if (folder && depth + 1 < MAX_DEPTH) queue.push({ dir: absolute, depth: depth + 1 })
    }
  }
  return entries
}

// Basename matches beat path matches so `@index` finds index.ts first.
function score(entry, needle) {
  const value = entry.path.toLowerCase()
  const base = value.replace(/\/$/, '').split('/').pop() ?? ''
  if (base === needle) return 5
  if (base.startsWith(needle)) return 4
  if (base.includes(needle)) return 3
  if (value.includes(needle)) return 2
  return 0
}

function search(entries, query, limit) {
  const needle = String(query ?? '')
    .trim()
    .toLowerCase()
  if (!needle) return entries.slice(0, limit)
  return entries
    .map((entry) => ({ entry, rank: score(entry, needle) }))
    .filter((item) => item.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.entry.path.length - b.entry.path.length)
    .slice(0, limit)
    .map((item) => item.entry)
}

class FileIndex {
  constructor({ ttl = TTL } = {}) {
    this.ttl = ttl
    this.cache = new Map()
  }

  async entries(folder) {
    const cached = this.cache.get(folder)
    const now = Date.now()
    if (cached && now - cached.at < this.ttl && cached.pending === null) return cached.list
    if (cached?.pending) return cached.pending
    const pending = walk(folder)
      .then((list) => {
        this.cache.set(folder, { at: Date.now(), list, pending: null })
        return list
      })
      .catch((error) => {
        this.cache.delete(folder)
        throw error
      })
    this.cache.set(folder, { at: cached?.at ?? 0, list: cached?.list ?? [], pending })
    return pending
  }

  async list(folder, query, limit = 25) {
    const root = validateFolder(folder)
    const entries = await this.entries(root)
    return search(entries, query, Math.max(1, Math.min(100, limit)))
  }
}

module.exports = { FileIndex, walk, search, score, MAX_ENTRIES, SKIP }
