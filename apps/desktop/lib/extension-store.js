'use strict'
// Runtime extension store: userData/extensions/<id>@<version>/. Pure Node
// (no Electron) so it can be unit tested; main.js wires it up.
const fs = require('node:fs')
const path = require('node:path')

// Compares dotted version strings numerically ("1.2.10" > "1.2.9").
function compareVersions(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da !== db) return da - db
  }
  return 0
}

function ensureStore(storeDir) {
  fs.mkdirSync(storeDir, { recursive: true })
}

// Copies each <id>@<version> directory from sourceDir into storeDir unless a
// directory with the same name already exists there. Returns how many were
// copied.
function seedDefaults(storeDir, sourceDir) {
  if (!fs.existsSync(sourceDir)) return 0
  let copied = 0
  for (const name of fs.readdirSync(sourceDir)) {
    const src = path.join(sourceDir, name)
    if (!fs.statSync(src).isDirectory()) continue
    const dst = path.join(storeDir, name)
    if (fs.existsSync(dst)) continue
    fs.cpSync(src, dst, { recursive: true })
    copied += 1
  }
  return copied
}

// Lists installed extensions as { id, version, url, styleUrl }. When several
// versions of an id are present, the highest version wins. Directories without
// a readable manifest.json are ignored.
function scanStore(storeDir, baseUrl = 'sisyphus-ext://ext') {
  const out = []
  if (!fs.existsSync(storeDir)) return out
  const byId = new Map()
  for (const name of fs.readdirSync(storeDir)) {
    if (!/^[^@]+@[^@]+$/.test(name)) continue
    const manifestPath = path.join(storeDir, name, 'manifest.json')
    if (!fs.existsSync(manifestPath)) continue
    let manifest
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    } catch {
      continue
    }
    if (typeof manifest.id !== 'string' || typeof manifest.entry !== 'string') continue
    const prev = byId.get(manifest.id)
    if (!prev || compareVersions(manifest.version, prev.version) > 0) {
      byId.set(manifest.id, {
        id: manifest.id,
        version: manifest.version,
        url: `${baseUrl}/${name}/${manifest.entry}`,
        ...(typeof manifest.style === 'string'
          ? { styleUrl: `${baseUrl}/${name}/${manifest.style}` }
          : {}),
      })
    }
  }
  return [...byId.values()]
}

module.exports = { compareVersions, ensureStore, seedDefaults, scanStore }
