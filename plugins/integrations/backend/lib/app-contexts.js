'use strict'
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const { validateFolder } = require('@sisyphus/native/folder')

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

function contextId(name) {
  const slug = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 42)
  return `${slug || 'context'}-${randomUUID().slice(0, 8)}`
}

function normalizeAction(action, { validateFolders = true } = {}) {
  if (!action || typeof action !== 'object') throw new Error('Invalid context action')
  if (action.integration === 'vscode') {
    if (!Array.isArray(action.folders) || !action.folders.length || action.folders.length > 12)
      throw new Error('Choose at least one folder for VS Code')
    const folders = [
      ...new Set(
        action.folders.map((folder) => {
          if (validateFolders) return validateFolder(folder)
          if (typeof folder !== 'string' || !path.isAbsolute(folder) || folder.length > 4096)
            throw new Error('Invalid VS Code folder')
          return path.normalize(folder)
        }),
      ),
    ]
    const profile = typeof action.profile === 'string' ? action.profile.trim() : ''
    if (profile.length > 80) throw new Error('VS Code profile names must be 80 characters or less')
    return {
      integration: 'vscode',
      folders,
      window: action.window === 'reuse' ? 'reuse' : 'new',
      ...(profile ? { profile } : {}),
    }
  }
  if (action.integration === 'browser') {
    if (!Array.isArray(action.urls) || !action.urls.length || action.urls.length > 24)
      throw new Error('Add at least one browser URL')
    const urls = [
      ...new Set(
        action.urls.map((value) => {
          const text = String(value).trim()
          if (text.length > 2048) throw new Error('Browser URLs must be 2,048 characters or less')
          const url = new URL(text)
          if (!['http:', 'https:'].includes(url.protocol))
            throw new Error('Browser contexts only support HTTP and HTTPS URLs')
          if (url.username || url.password)
            throw new Error('Browser context URLs cannot contain credentials')
          return url.toString()
        }),
      ),
    ]
    return { integration: 'browser', urls }
  }
  throw new Error(`Unknown integration: ${action.integration}`)
}

function normalizeContext(input, options) {
  if (!input || typeof input !== 'object') throw new Error('Invalid context')
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > 60) throw new Error('Context names must be 1–60 characters')
  const id = input.id || contextId(name)
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('Invalid context id')
  if (!Array.isArray(input.actions) || !input.actions.length || input.actions.length > 8)
    throw new Error('Add at least one app to this context')
  const actions = input.actions.map((action) => normalizeAction(action, options))
  if (new Set(actions.map((action) => action.integration)).size !== actions.length)
    throw new Error('A context can only configure each integration once')
  return { id, name, actions }
}

class AppContexts {
  constructor({ storage, integrations }) {
    this.storage = storage
    this.integrations = integrations
  }

  list() {
    const value = this.storage.get('app.contexts', 'contexts.v1')
    if (!Array.isArray(value)) return []
    return value.flatMap((entry) => {
      try {
        return [normalizeContext(entry, { validateFolders: false })]
      } catch {
        return []
      }
    })
  }

  save(input) {
    const context = normalizeContext(input)
    const next = [context, ...this.list().filter((item) => item.id !== context.id)]
    this.storage.set('app.contexts', 'contexts.v1', next)
    return context
  }

  saveAction({ id, name, action }) {
    const existing = id ? this.list().find((item) => item.id === id) : null
    if (id && !existing) throw new Error('App context not found')
    const context = normalizeContext({ id, name, actions: [action] })
    const normalized = context.actions[0]
    // A legacy bundle appears in both launchers. Editing one half detaches it
    // when renamed, so the other app keeps its original name and configuration.
    if (existing && existing.actions.length > 1 && context.name !== existing.name) {
      const saved = { ...context, id: contextId(context.name) }
      const remainder = {
        ...existing,
        actions: existing.actions.filter((item) => item.integration !== normalized.integration),
      }
      this.storage.set('app.contexts', 'contexts.v1', [
        saved,
        ...this.list().map((item) => (item.id === id ? remainder : item)),
      ])
      return saved
    }
    if (existing)
      context.actions.push(
        ...existing.actions.filter((item) => item.integration !== normalized.integration),
      )
    this.storage.set('app.contexts', 'contexts.v1', [
      context,
      ...this.list().filter((item) => item.id !== context.id),
    ])
    return context
  }

  delete(id, integration) {
    if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('Invalid context id')
    this.storage.set(
      'app.contexts',
      'contexts.v1',
      this.list().flatMap((item) => {
        if (item.id !== id) return [item]
        if (!integration) return []
        const actions = item.actions.filter((action) => action.integration !== integration)
        return actions.length ? [{ ...item, actions }] : []
      }),
    )
  }

  async launch(id, integration) {
    const context = this.list().find((item) => item.id === id)
    if (!context) throw new Error('App context not found')
    if (!integration && context.actions.length > 1)
      throw new Error('Choose which app to open: vscode or browser')
    const actions = context.actions.filter(
      (action) => !integration || action.integration === integration,
    )
    if (!actions.length) throw new Error('This context has no entry for that app')
    const results = []
    for (const action of actions)
      results.push(await this.integrations.launch(action.integration, { ...action, context }))
    return { id: context.id, name: context.name, launched: results }
  }
}

module.exports = { AppContexts, normalizeContext, normalizeAction, ID_RE }
