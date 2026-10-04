'use strict'
const fs = require('node:fs')
const path = require('node:path')

function launcherPrograms(contexts) {
  return contexts.map((context) => ({
    id: context.id,
    title: context.name,
    description: '',
    color: 'blue',
    nodes: context.actions.map((action, index) => ({
      id: `step-${index}`,
      type: 'open',
      title: action.integration === 'browser' ? 'Open tabs' : 'Open project',
      x: 300,
      y: 60 + index * 160,
      config:
        action.integration === 'browser'
          ? { targets: action.urls, application: 'default', window: 'new' }
          : {
              targets: action.folders,
              application: 'editor',
              profile: action.profile ?? '',
              window: action.window,
            },
    })),
    edges: context.actions.map((_, index) => ({ from: 'start', to: `step-${index}` })),
  }))
}
function readLauncherPrograms(userData) {
  const file = path.join(userData, 'storage', 'app.contexts.json')
  let saved
  try {
    saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw new Error(`Cannot import ${file}: ${error.message}`)
  }
  const contexts = saved?.['contexts.v1'] ?? []
  if (!Array.isArray(contexts)) throw new Error(`Invalid launchers in ${file}`)
  return launcherPrograms(contexts)
}
module.exports = { launcherPrograms, readLauncherPrograms }
