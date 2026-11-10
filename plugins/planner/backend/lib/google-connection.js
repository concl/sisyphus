const { existsSync } = require('node:fs')
const { open } = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { z } = require('zod')
const {
  authorize,
  desktopClient,
  googleCalendar,
  GoogleReconnectError,
  scopes,
} = require('./google-calendar.js')
const { syncGoogle } = require('./google-sync.js')

const scope = 'planner.google'
const key = 'connection.v1'
const interval = 5 * 60 * 1000
const clientFilename = 'google-calendar.oauth.json'
const setupPages = new Map([
  [
    'calendar',
    'https://console.cloud.google.com/flows/enableapi?apiid=calendar-json.googleapis.com',
  ],
  ['branding', 'https://console.cloud.google.com/auth/branding'],
  ['audience', 'https://console.cloud.google.com/auth/audience'],
  ['scopes', 'https://console.cloud.google.com/auth/scopes'],
  ['clients', 'https://console.cloud.google.com/auth/clients'],
])

async function readClient(filename) {
  const file = await open(filename, 'r')
  try {
    const buffer = Buffer.alloc(16385)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead === buffer.length) throw new Error('Choose a Google OAuth client JSON file.')
    return desktopClient(buffer.toString('utf8', 0, bytesRead))
  } finally {
    await file.close()
  }
}

function registerGoogleSync(
  ctx,
  { transport, storage, planner, userData, electron, fetch = globalThis.fetch },
) {
  const { BrowserWindow, dialog, safeStorage, shell } = electron
  const configuredFile = path.join(userData, clientFilename)
  const canEncrypt = () =>
    safeStorage.isEncryptionAvailable() &&
    safeStorage.getSelectedStorageBackend?.() !== 'basic_text'
  const encode = (value) => safeStorage.encryptString(JSON.stringify(value)).toString('base64')
  const decode = (value) => JSON.parse(safeStorage.decryptString(Buffer.from(value, 'base64')))
  const lifetime = new AbortController()
  const options = {
    fetch,
    signal: lifetime.signal,
    openExternal: (url) => shell.openExternal(url),
  }
  let timer
  let syncJob
  let syncError = ''
  let needsReconnect = false
  let busy = false
  let signIn
  ctx.effect(() => () => {
    clearTimeout(timer)
    lifetime.abort()
  })
  const load = () => storage.get(scope, key) || {}
  const save = (state) => {
    options.signal.throwIfAborted()
    storage.set(scope, key, state)
  }
  const status = () => {
    const state = load()
    return {
      connected: !!state.encrypted,
      hasClient: !!(state.client || state.encrypted || existsSync(configuredFile)),
      calendar: state.binding?.name || null,
      automatic: state.automatic === true,
      syncing: !!syncJob,
      lastSync: state.lastSync || null,
      syncError,
      scopes,
    }
  }
  const publish = () => {
    const value = status()
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) transport.send(window.webContents, 'planner.google.changed', value)
    }
  }
  const ensureCalendar = (binding) => {
    const document = planner.document()
    if (document.calendars.some((calendar) => calendar.id === binding.localId)) return
    const calendar = {
      id: binding.localId,
      name: binding.name,
      color: binding.color,
      actor: planner.actor,
      updatedAt: new Date().toISOString(),
    }
    planner.save({ ...document, calendars: [...document.calendars, calendar] })
  }
  const connectAPI = (state) => {
    if (!state.encrypted) throw new Error('Connect a Google account first.')
    if (!canEncrypt()) throw new Error('Encrypted storage is unavailable.')
    let credentials
    try {
      credentials = decode(state.encrypted)
    } catch {
      throw new GoogleReconnectError()
    }
    return googleCalendar(credentials, options)
  }
  const schedule = (delay = interval) => {
    clearTimeout(timer)
    if (options.signal.aborted || needsReconnect) return
    const { binding, automatic, encrypted } = load()
    if (!binding || automatic !== true || !encrypted) return
    timer = setTimeout(() => {
      if (busy) schedule()
      else void sync().catch(() => {})
    }, delay)
    timer.unref()
  }
  async function sync() {
    if (syncJob) return syncJob
    if (busy) throw new Error('Google Calendar is already working.')
    options.signal.throwIfAborted()
    const state = load()
    if (!state.binding) throw new Error('Link a Google calendar first.')
    syncError = ''
    syncJob = Promise.resolve().then(async () => {
      try {
        const api = await connectAPI(state)
        options.signal.throwIfAborted()
        ensureCalendar(state.binding)
        const result = await syncGoogle({
          planner,
          state,
          saveState: save,
          api,
          signal: options.signal,
        })
        save({ ...load(), lastSync: { at: new Date().toISOString(), result } })
        needsReconnect = false
        return result
      } catch (error) {
        needsReconnect = error instanceof GoogleReconnectError || error.status === 401
        syncError = needsReconnect ? new GoogleReconnectError().message : error.message
        throw error
      } finally {
        syncJob = undefined
        if (!options.signal.aborted) {
          schedule()
          publish()
        }
      }
    })
    publish()
    return syncJob
  }
  const handle = (method, run) =>
    ctx.effect(() =>
      transport.handle(`planner.google.${method}`, async (input, sender) => {
        if (busy || syncJob) throw new Error('Google Calendar is already working.')
        options.signal.throwIfAborted()
        busy = true
        try {
          return await run(input, sender)
        } finally {
          busy = false
        }
      }),
    )
  ctx.effect(() => transport.handle('planner.google.status', status))
  ctx.effect(() =>
    transport.handle('planner.google.openSetupPage', async (page) => {
      const url = setupPages.get(page)
      if (!url) throw new Error('Unknown Google Calendar setup page.')
      await shell.openExternal(url)
    }),
  )
  ctx.effect(() => transport.handle('planner.google.sync', sync))
  ctx.effect(() =>
    transport.handle('planner.google.cancelConnect', () => {
      signIn?.abort()
    }),
  )
  handle('connect', async (_, sender) => {
    const state = load()
    if (!canEncrypt()) throw new Error('Encrypted storage is unavailable.')
    let client
    try {
      client = await readClient(configuredFile)
    } catch (error) {
      if (error.code !== 'ENOENT')
        throw new Error(`Check the Desktop app OAuth JSON in ${clientFilename}.`)
      if (state.client || state.encrypted) {
        try {
          const { client_id, client_secret } = decode(state.client || state.encrypted)
          client = desktopClient(JSON.stringify({ installed: { client_id, client_secret } }))
        } catch {
          // The file picker can replace credentials that can no longer be read.
        }
      }
    }
    if (!client) {
      const owner = BrowserWindow.fromWebContents(sender)
      const choice = await dialog.showOpenDialog(owner, {
        title: 'Choose Google OAuth Desktop app credentials',
        filters: [{ name: 'JSON files', extensions: ['json'] }],
        properties: ['openFile'],
      })
      if (choice.canceled) return status()
      client = await readClient(choice.filePaths[0])
    }
    const cached = { ...state, client: encode(client) }
    save(cached)
    publish()
    signIn = new AbortController()
    const signal = AbortSignal.any([options.signal, signIn.signal])
    try {
      const credentials = await authorize(client, { ...options, signal })
      signal.throwIfAborted()
      save({ ...cached, encrypted: encode(credentials) })
      needsReconnect = false
      syncError = ''
      schedule(0)
    } finally {
      signIn = undefined
    }
    return status()
  })
  handle('calendars', async () => (await connectAPI(load())).calendars())
  handle('link', async (input) => {
    const remoteId = z.string().min(1).max(1024).parse(input)
    const state = load()
    if (state.binding) throw new Error('Disconnect the current calendar before linking another.')
    const calendars = await (await connectAPI(state)).calendars()
    const calendar = calendars.find(({ id }) => id === remoteId)
    if (!calendar) throw new Error('Choose a Google calendar you can edit.')
    if (planner.document().calendars.length >= 1000)
      throw new Error('Calendar has reached its 1,000 calendar limit.')
    const binding = { localId: randomUUID(), remoteId, name: calendar.name, color: calendar.color }
    save({ ...state, binding, links: [], automatic: true })
    ensureCalendar(binding)
    schedule(0)
    return status()
  })
  handle('setAutomatic', (input) => {
    const automatic = z.boolean().parse(input)
    const state = load()
    if (!state.binding) throw new Error('Link a Google calendar first.')
    save({ ...state, automatic })
    schedule(0)
    return status()
  })
  handle('disconnect', () => {
    save({ client: load().client })
    needsReconnect = false
    syncError = ''
    schedule()
    return status()
  })
  schedule(0)
}

module.exports = { registerGoogleSync }
