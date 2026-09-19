'use strict'
// Conversation folder rules. Pure Node so validation stays testable without
// Electron; callers supply a path from the folder picker or the transport.
const fs = require('node:fs')
const path = require('node:path')

const MAX_PATH = 4096

// A conversation folder is an existing absolute directory. Returns the
// canonical path so stored threads and tool calls agree after a symlink.
function validateFolder(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_PATH)
    throw new Error('Choose a folder for this conversation.')
  const resolved = path.resolve(value)
  let stats
  try {
    stats = fs.statSync(resolved)
  } catch {
    throw new Error('That folder is no longer available.')
  }
  if (!stats.isDirectory()) throw new Error('Choose a folder, not a file.')
  return fs.realpathSync(resolved)
}

// Realpath a path whose tail may not exist yet (a new file the agent writes).
function realExistingPrefix(target) {
  let current = target
  const trailing = []
  while (true) {
    if (fs.existsSync(current)) {
      const real = fs.realpathSync(current)
      return trailing.length ? path.join(real, ...trailing.reverse()) : real
    }
    const parent = path.dirname(current)
    if (parent === current) return path.resolve(target)
    trailing.push(path.basename(current))
    current = parent
  }
}

// Resolves a path the model asked for inside the folder and refuses anything
// that escapes it, including through a symlinked directory.
function resolveInside(folder, target) {
  const root = validateFolder(folder)
  const requested = path.resolve(root, typeof target === 'string' && target.trim() ? target : '.')
  const relative = path.relative(root, realExistingPrefix(requested))
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('That path is outside this conversation folder. Work inside the chosen folder.')
  return requested
}

// Short label for the UI; falls back to the full path for a filesystem root.
function folderLabel(folder) {
  return path.basename(folder) || folder
}

module.exports = { validateFolder, resolveInside, folderLabel, MAX_PATH }
