const { app, BrowserWindow, ipcMain, Menu } = require('electron')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { spawn, spawnSync, execFileSync } = require('node:child_process')

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
// Terminal backend detection
// ---------------------------------------------------------------------------

function commandExists(cmd) {
  try {
    const probe = WINDOWS ? 'where.exe' : 'which'
    return spawnSync(probe, [cmd], { stdio: 'ignore', windowsHide: true }).status === 0
  } catch {
    return false
  }
}

function findGitBash() {
  const candidates = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
  ]
  return candidates.find((p) => fs.existsSync(p)) || null
}

// Returns the default WSL distro name, or null when WSL is missing/unset.
function detectWslDistro() {
  try {
    const out = execFileSync('wsl.exe', ['-l', '-q'], {
      encoding: 'buffer',
      timeout: 4000,
      windowsHide: true,
    })
    // Old WSL builds output UTF-16LE; detect it by the NUL bytes.
    const text = out
      .toString(out.includes(0) ? 'utf16le' : 'utf8')
      .replace(/^\uFEFF/, '')
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    return lines[0] || null
  } catch {
    return null
  }
}

function detectBackends() {
  const backends = []
  let defaultId = null

  if (WINDOWS) {
    backends.push({
      id: 'powershell',
      name: 'PowerShell',
      command: 'powershell.exe',
      args: ['-NoLogo'],
    })
    if (commandExists('pwsh.exe')) {
      backends.push({ id: 'pwsh', name: 'PowerShell 7', command: 'pwsh.exe', args: ['-NoLogo'] })
    }
    backends.push({
      id: 'cmd',
      name: 'Command Prompt',
      command: process.env.COMSPEC || 'cmd.exe',
      args: [],
    })
    const gitBash = findGitBash()
    if (gitBash) {
      backends.push({ id: 'gitbash', name: 'Git Bash', command: gitBash, args: ['--login', '-i'] })
    }
    const distro = detectWslDistro()
    if (distro) {
      backends.push({ id: 'wsl', name: `WSL: ${distro}`, command: 'wsl.exe', args: ['-d', distro] })
    }
    // Windows PowerShell is the stock default shell on Windows.
    defaultId = 'powershell'
  } else {
    const shell = process.env.SHELL || (fs.existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash')
    const name = path.basename(shell)
    backends.push({ id: name, name: name[0].toUpperCase() + name.slice(1), command: shell, args: [] })
    defaultId = name
  }

  if (!backends.find((b) => b.id === defaultId)) defaultId = backends[0].id
  return { backends, defaultId }
}

let backendCache = null
function getBackends() {
  if (!backendCache) backendCache = detectBackends()
  return backendCache
}

// ---------------------------------------------------------------------------
// PTY management (ptyId -> { pty, webContents })
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

    const entry = { pty: term, wc, suppressExit: false }
    ptys.set(ptyId, entry)

    term.onData((data) => {
      if (!wc.isDestroyed()) wc.send('terminal:data', { ptyId, data })
    })
    term.onExit(({ exitCode }) => {
      ptys.delete(ptyId)
      // Don't announce shells we killed deliberately (tab close, restart, quit).
      if (!wc.isDestroyed() && !entry.suppressExit) {
        wc.send('terminal:exit', { ptyId, exitCode })
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

function registerTerminalIpc() {
  ipcMain.handle('terminal:list-backends', () => getBackends())

  ipcMain.handle('terminal:spawn', (event, { ptyId, backendId, cols, rows }) => {
    if (!pty) return { ok: false, error: 'node-pty is not available' }
    if (!ptyId || typeof backendId !== 'string') return { ok: false, error: 'bad arguments' }
    killPty(ptyId) // replacing an existing tab's shell
    return spawnTerminal(event.sender, ptyId, backendId, cols, rows)
  })

  ipcMain.on('terminal:input', (_event, { ptyId, data }) => {
    const entry = ptys.get(ptyId)
    if (!entry || typeof data !== 'string') return
    try {
      entry.pty.write(data)
    } catch {
      /* pty already closed */
    }
  })

  ipcMain.on('terminal:resize', (_event, { ptyId, cols, rows }) => {
    const entry = ptys.get(ptyId)
    if (!entry) return
    try {
      entry.pty.resize(Math.max(2, cols), Math.max(2, rows))
    } catch {
      /* pty already exited */
    }
  })

  ipcMain.on('terminal:kill', (_event, { ptyId }) => killPty(ptyId))
}

// ---------------------------------------------------------------------------
// Window + app lifecycle
// ---------------------------------------------------------------------------

// The renderer is the React app in apps/frontend (built to dist/).
const frontendIndex = path.join(__dirname, '..', 'frontend', 'dist', 'index.html')

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
  // Ctrl+Shift+I accelerator is unavailable; bind F12 instead.
  wc.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      wc.toggleDevTools()
    }
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
      try {
        const result = await win.webContents.executeJavaScript(`(async () => {
          const waitFor = (sel, ms = 8000) => new Promise((resolve, reject) => {
            const t0 = Date.now();
            const iv = setInterval(() => {
              if (document.querySelector(sel)) { clearInterval(iv); resolve(true); }
              else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('timeout waiting for ' + sel)); }
            }, 50);
          });

          await waitFor('[data-page]');
          await waitFor('[data-testid="terminal-page"]');

          const backends = await window.terminals.listBackends();

          // Icons: the sprite must be inlined and every <use> must resolve.
          const spriteSymbols = document.querySelectorAll('#icons-sprite symbol').length;
          const uses = [...document.querySelectorAll('svg use')].map((u) => u.getAttribute('href'));
          const iconsResolve = spriteSymbols >= 6 && uses.length > 0 && uses.every((h) => !!h && h.startsWith('#') && !!document.getElementById(h.slice(1)));

          // Open the Terminal page the way a user would: creates the first tab + shell.
          document.querySelector('[data-page="terminal"]').click();
          await waitFor('[data-testid="terminal-tab"]');

          const uiReady =
            document.querySelectorAll('[data-page]').length === 2 &&
            document.querySelectorAll('[data-testid="terminal-tab"]').length === 1 &&
            !!document.querySelector('.xterm') &&
            !!document.querySelector('[aria-haspopup="menu"]');

          const res = await window.terminals.spawn({ ptyId: 'smoke-1', backendId: backends.defaultId, cols: 80, rows: 24 });
          const output = await new Promise((resolve) => {
            const off = window.terminals.onData((d) => {
              if (d.ptyId !== 'smoke-1') return;
              if (d.data.includes('SMOKE_OK')) { off(); resolve('SMOKE_OK'); }
            });
            window.terminals.write('smoke-1', 'echo SMOKE_OK; exit\\r');
            setTimeout(() => { off(); resolve('TIMEOUT'); }, 8000);
          });
          window.terminals.kill('smoke-1');

          // Close the first tab; a fresh one should be auto-created.
          const countBeforeClose = document.querySelectorAll('[data-testid="terminal-tab"]').length;
          const closeBtn = document.querySelector('[data-testid="terminal-tab-close"]');
          closeBtn && closeBtn.click();
          await new Promise((r) => setTimeout(r, 400));
          const tabsAfterClose = document.querySelectorAll('[data-testid="terminal-tab"]').length;
          const tabLabels = [...document.querySelectorAll('[data-testid="terminal-tab-name"]')].map((e) => e.textContent);

          return JSON.stringify({ defaultId: backends.defaultId, spriteSymbols, iconsResolve, uiReady, countBeforeClose, tabsAfterClose, tabLabels, spawnOk: res.ok, output });
        })()`)
        console.log('SMOKE_RESULT ' + result)
      } catch (err) {
        console.log('SMOKE_ERROR ' + ((err && err.message) || err))
      }
      // Exercise the window-close path (kills all shells) and quit.
      win.close()
    })
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  registerTerminalIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  for (const ptyId of [...ptys.keys()]) killPty(ptyId)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
