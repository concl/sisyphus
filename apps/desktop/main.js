const { app, BrowserWindow, ipcMain, Menu, protocol } = require('electron')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const { IPC } = require('@sisyphus/shared')
const { detectBackends } = require('./lib/backends')
const { ServiceSupervisor } = require('./lib/service-supervisor')
const { collectProcesses } = require('./lib/processes')
const { ensureStore, seedDefaults, scanStore } = require('./lib/extension-store')
const { ScopedStore, isValidScope } = require('./lib/app-storage')

// Serve runtime extensions from the store over a privileged scheme so the
// renderer can `import()` their entry modules (must be registered pre-ready).
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sisyphus-ext',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
])

// node-pty is a native module; load it defensively so the app still boots
// (e.g. during dev on a machine where it could not be installed).
let pty = null
try {
  pty = require('node-pty')
} catch (err) {
  console.error('[terminal] node-pty failed to load:', err.message)
}

const WINDOWS = process.platform === 'win32'

// ---------------------------------------------------------------------------
// Terminal backend detection (pure logic lives in lib/backends.js)
// ---------------------------------------------------------------------------

let backendCache = null
function getBackends() {
  if (!backendCache) backendCache = detectBackends()
  return backendCache
}

// ---------------------------------------------------------------------------
// PTY management (ptyId -> { pty, wc, backendId, suppressExit })
// ---------------------------------------------------------------------------

const ptys = new Map()

function spawnTerminal(wc, ptyId, backendId, cols, rows) {
  const backend = getBackends().backends.find((b) => b.id === backendId)
  if (!backend) return { ok: false, error: `unknown backend "${backendId}"` }

  try {
    const term = pty.spawn(backend.command, backend.args, {
      name: 'xterm-256color',
      cols: Math.max(2, cols || 80),
      rows: Math.max(2, rows || 24),
      cwd: process.env.USERPROFILE || os.homedir(),
      env: { ...process.env, TERM: 'xterm-256color' },
    })

    const entry = { pty: term, wc, backendId, suppressExit: false }
    ptys.set(ptyId, entry)

    term.onData((data) => {
      if (!wc.isDestroyed()) wc.send(IPC.terminalData, { ptyId, data })
    })
    term.onExit(({ exitCode }) => {
      ptys.delete(ptyId)
      // Don't announce shells we killed deliberately (tab close, restart, quit).
      if (!wc.isDestroyed() && !entry.suppressExit) {
        wc.send(IPC.terminalExit, { ptyId, exitCode })
      }
    })

    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

function killPty(ptyId, notify = false) {
  const entry = ptys.get(ptyId)
  if (!entry) return
  entry.suppressExit = !notify
  ptys.delete(ptyId)

  const { pty: term } = entry
  if (WINDOWS && term.pid) {
    // node-pty's ConPTY kill() forks a console-list agent that races the
    // native kill and crashes with an "AttachConsole failed" stack trace on
    // stderr every time. Kill the shell tree directly instead; the pty's own
    // exit callback then cleans up the conpty handles.
    try {
      spawn('taskkill.exe', ['/PID', String(term.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
    } catch {
      /* already gone */
    }
  } else {
    try {
      term.kill()
    } catch {
      /* already gone */
    }
  }
}

// ---------------------------------------------------------------------------
// Managed services (the python-host FastAPI app, spawned/stopped here)
// ---------------------------------------------------------------------------

// The python-host service ships alongside the packaged app (extraResources);
// in dev it lives in the repo under services/.
function resolvePythonHostDir() {
  const packaged = path.join(process.resourcesPath, 'python-host')
  if (fs.existsSync(packaged)) return packaged
  return path.join(__dirname, '..', '..', 'services', 'python-host')
}

const pythonHost = new ServiceSupervisor({
  hostDir: resolvePythonHostDir(),
})

// ---------------------------------------------------------------------------
// Runtime extensions (store under userData/extensions)
// ---------------------------------------------------------------------------

// Bundled defaults that seed the store on first run: shipped in the packaged
// app via extraResources, or read from the repo in dev.
function resolveExtensionSeedDir() {
  const packaged = path.join(process.resourcesPath, 'runtime-extensions')
  if (fs.existsSync(packaged)) return packaged
  return path.join(__dirname, '..', '..', 'packages', 'runtime-extensions')
}

// Resolved in whenReady; used by the extensions:list IPC handler.
let extensionStoreDir = null

// Resolved in whenReady; used by the storage:* IPC handlers.
let appStorageDir = null

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.js' || ext === '.mjs') return 'text/javascript'
  if (ext === '.css') return 'text/css'
  if (ext === '.json') return 'application/json'
  if (ext === '.html') return 'text/html'
  return 'application/octet-stream'
}

// Serves files from the extension store: sisyphus-ext://ext/<id>@<version>/<file>.
function registerExtensionProtocol(storeDir) {
  protocol.handle('sisyphus-ext', (request) => {
    const url = new URL(request.url)
    const segments = url.pathname.split('/').filter(Boolean)
    const [idver, ...rest] = segments
    if (!idver || idver.includes('..') || idver.includes('\\') || rest.length === 0) {
      return new Response('not found', { status: 404 })
    }
    const base = path.resolve(storeDir, idver)
    const file = path.resolve(base, ...rest)
    if (!file.startsWith(base + path.sep)) return new Response('forbidden', { status: 403 })
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return new Response('not found', { status: 404 })
    }
    return new Response(fs.readFileSync(file), {
      headers: { 'content-type': mimeFor(file), 'access-control-allow-origin': '*' },
    })
  })
}

function registerIpc() {
  // terminals
  ipcMain.handle(IPC.terminalListBackends, () => getBackends())

  ipcMain.handle(IPC.terminalSpawn, (event, { ptyId, backendId, cols, rows }) => {
    if (!pty) return { ok: false, error: 'node-pty is not available' }
    if (!ptyId || typeof backendId !== 'string') return { ok: false, error: 'bad arguments' }
    killPty(ptyId) // replacing an existing tab's shell
    return spawnTerminal(event.sender, ptyId, backendId, cols, rows)
  })

  ipcMain.on(IPC.terminalInput, (_event, { ptyId, data }) => {
    const entry = ptys.get(ptyId)
    if (!entry || typeof data !== 'string') return
    try {
      entry.pty.write(data)
    } catch {
      /* pty already closed */
    }
  })

  ipcMain.on(IPC.terminalResize, (_event, { ptyId, cols, rows }) => {
    const entry = ptys.get(ptyId)
    if (!entry) return
    try {
      entry.pty.resize(Math.max(2, cols), Math.max(2, rows))
    } catch {
      /* pty already exited */
    }
  })

  ipcMain.on(IPC.terminalKill, (_event, { ptyId }) => killPty(ptyId))

  // managed services: status + a scoped HTTP proxy into the service's API.
  // Paths are validated so the proxy can only reach the service itself.
  ipcMain.handle(IPC.serviceStatus, () => pythonHost.status())
  ipcMain.handle(IPC.serviceCall, async (_event, { path: apiPath }) => {
    if (typeof apiPath !== 'string' || !apiPath.startsWith('/')) {
      return { ok: false, error: 'invalid path' }
    }
    if (!pythonHost.running) return { ok: false, error: 'python-host is not running' }
    try {
      const res = await fetch(pythonHost.url + apiPath, { signal: AbortSignal.timeout(5000) })
      const body = await res.json().catch(() => null)
      return { ok: res.ok, status: res.status, body }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // managed subprocess registry (services + terminal shells)
  ipcMain.handle(IPC.processesList, () => collectProcesses(pythonHost, ptys, getBackends()))

  // runtime extensions: installed extensions from the userData store
  ipcMain.handle(IPC.extensionsList, () => scanStore(extensionStoreDir))

  // scoped key-value data storage (userData/storage/<scope>.json). The app
  // and extensions share this API; scope is validated to a safe file name.
  ipcMain.handle(IPC.storageGet, (_event, { scope, key }) => {
    if (!isValidScope(scope) || typeof key !== 'string') return undefined
    return new ScopedStore(path.join(appStorageDir, scope + '.json')).read(key)
  })
  ipcMain.handle(IPC.storageSet, (_event, { scope, key, value }) => {
    if (!isValidScope(scope) || typeof key !== 'string') return
    new ScopedStore(path.join(appStorageDir, scope + '.json')).write(key, value)
  })
  ipcMain.handle(IPC.storageDelete, (_event, { scope, key }) => {
    if (!isValidScope(scope) || typeof key !== 'string') return
    new ScopedStore(path.join(appStorageDir, scope + '.json')).remove(key)
  })
}

// ---------------------------------------------------------------------------
// Window + app lifecycle
// ---------------------------------------------------------------------------

// The renderer is the React app in apps/frontend (built to dist/). In a
// packaged build the bundle is staged at frontend-dist/ inside the app.
function resolveFrontendIndex() {
  const dev = path.join(__dirname, '..', 'frontend', 'dist', 'index.html')
  if (fs.existsSync(dev)) return dev
  return path.join(__dirname, 'frontend-dist', 'index.html')
}
const frontendIndex = resolveFrontendIndex()

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#0d0f14',
    title: 'Sisyphus',
    titleBarStyle: 'hidden',
    ...(process.platform !== 'darwin'
      ? { titleBarOverlay: { color: '#0d0f14', symbolColor: '#9aa4b2', height: 40 } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Make sure every shell owned by this window dies with it.
  const wc = win.webContents
  win.on('closed', () => {
    for (const [ptyId, entry] of ptys) {
      if (entry.wc === wc || entry.wc.isDestroyed()) killPty(ptyId)
    }
  })

  // DevTools toggle. The app sets no application menu, so the default
  // accelerators are unavailable; bind F12 plus the conventional
  // Ctrl+Shift+I (Cmd+Shift+I on macOS) shortcuts.
  wc.on('before-input-event', (_event, input) => {
    const isDevToolsShortcut =
      input.type === 'keyDown' &&
      input.key.toLowerCase() === 'i' &&
      input.shift &&
      (input.control || input.meta)
    if (isDevToolsShortcut || (input.type === 'keyDown' && input.key === 'F12')) {
      wc.toggleDevTools()
    }
  })

  wc.on('did-fail-load', (_event, code, desc) => {
    console.log('[main] did-fail-load', code, desc)
  })

  // In dev, point at the Vite dev server (npm --prefix ../frontend run dev).
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    if (!fs.existsSync(frontendIndex)) {
      console.error('[main] frontend build not found at ' + frontendIndex)
      console.error('[main] run: npm --prefix ../frontend run build')
      app.quit()
      return
    }
    win.loadFile(frontendIndex)
  }

  // Headless smoke test: `npm start -- --smoke` (or `electron . --smoke`)
  if (process.argv.includes('--smoke')) {
    // Surface any main-process crash during the test (e.g. on window close).
    process.on('uncaughtException', (err) => {
      console.error('SMOKE_MAIN_CRASH ' + (err && err.stack ? err.stack : err))
    })

    win.webContents.once('did-finish-load', async () => {
      console.log('[main] smoke: did-finish-load')
      // Safety net: never leave the smoke hanging in packaged runs.
      const guard = setTimeout(() => {
        console.log('[main] smoke: timed out')
        win.close()
      }, 60_000)
      try {
        // The smoke script lives in its own file (smoke/smoke-script.js) —
        // real JS, no escaping mess — and is injected into the renderer.
        const smokeScript = fs.readFileSync(path.join(__dirname, 'smoke', 'smoke-script.js'), 'utf8')
        const result = await win.webContents.executeJavaScript(smokeScript)
        console.log('SMOKE_RESULT ' + result)
        // Packaged runs may not have stdout attached; mirror the result to a
        // file so it can be verified regardless.
        try {
          fs.writeFileSync(path.join(app.getPath('userData'), 'smoke-result.json'), result)
        } catch {
          /* non-fatal */
        }
        clearTimeout(guard)
      } catch (err) {
        console.log('SMOKE_ERROR ' + ((err && err.message) || err))
        clearTimeout(guard)
      }
      // Exercise the window-close path (kills all shells) and quit.
      win.close()
    })
  }
}

app.whenReady().then(() => {
  console.log('[main] ready')
  // Local data foundation: the per-user extension store under userData,
  // seeded with the bundled defaults (see ARCHITECTURE.md).
  extensionStoreDir = path.join(app.getPath('userData'), 'extensions')
  ensureStore(extensionStoreDir)
  appStorageDir = path.join(app.getPath('userData'), 'storage')
  const seeded = seedDefaults(extensionStoreDir, resolveExtensionSeedDir())
  if (seeded > 0) console.log(`[main] seeded ${seeded} default extension(s)`)

  Menu.setApplicationMenu(null)
  registerIpc()
  registerExtensionProtocol(extensionStoreDir)
  pythonHost.start()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  pythonHost.stop()
  for (const ptyId of [...ptys.keys()]) killPty(ptyId)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
