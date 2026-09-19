'use strict'
// Scoped key-value data storage for the app and its extensions. One JSON file
// per scope under userData/storage/<scope>.json; atomic writes via tmp+rename.
// Pure Node (no Electron); the storage plugin supplies the directory.
const fs = require('node:fs')
const path = require('node:path')

const SCOPE_RE = /^[a-zA-Z0-9._-]+$/

// Scopes are file names; reject anything that could escape the storage dir.
function isValidScope(scope) {
  return typeof scope === 'string' && scope.length > 0 && scope.length <= 64 && SCOPE_RE.test(scope)
}

class ScopedStore {
  constructor(file) {
    this.file = file
  }

  // Returns the stored value for key, or undefined when absent.
  read(key) {
    const data = this._load()
    return Object.hasOwn(data, key) ? data[key] : undefined
  }

  write(key, value) {
    const data = this._load()
    data[key] = value
    this._save(data)
  }

  remove(key) {
    const data = this._load()
    if (!(key in data)) return
    delete data[key]
    this._save(data)
  }

  _load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      // Missing or corrupt file: treat as an empty store.
      return {}
    }
  }

  _save(data) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
    fs.renameSync(tmp, this.file)
  }
}

module.exports = { ScopedStore, isValidScope }
