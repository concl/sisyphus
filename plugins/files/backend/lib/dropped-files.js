'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { validateFolder } = require('@sisyphus/native/folder')

function inside(root, target) {
  const relative = path.relative(root, target)
  return !relative.startsWith('..') && !path.isAbsolute(relative)
}

function inspect(paths) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 20)
    throw new Error('Drop between 1 and 20 files or folders')
  return paths.map((value) => {
    if (typeof value !== 'string' || !path.isAbsolute(value))
      throw new Error('Invalid dropped file')
    const canonical = fs.realpathSync(value)
    const stats = fs.statSync(canonical)
    if (!stats.isFile() && !stats.isDirectory()) throw new Error('Unsupported dropped item')
    return {
      absolutePath: canonical,
      name: path.basename(canonical) || canonical,
      type: stats.isDirectory() ? 'folder' : 'file',
      owner: stats.isDirectory() ? canonical : path.dirname(canonical),
    }
  })
}

function resolveDroppedPaths(paths, folder) {
  const items = inspect(paths)
  let root = null
  if (folder) root = validateFolder(folder)
  if (root && items.every((item) => inside(root, item.absolutePath))) {
    return {
      status: 'accepted',
      entries: items.map((item) => ({
        path: path.relative(root, item.absolutePath).split(path.sep).join('/') || '.',
        type: item.type,
      })),
    }
  }

  const owner = items[0].owner
  if (!items.every((item) => item.owner === owner) || path.dirname(owner) === owner)
    return {
      status: 'rejected',
      message: 'Drop items from one project folder at a time.',
    }
  return {
    status: 'needs-folder',
    suggestedFolder: owner,
    folderName: path.basename(owner) || owner,
    names: items.map((item) => item.name),
  }
}

module.exports = { resolveDroppedPaths }
