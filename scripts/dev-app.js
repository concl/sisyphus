#!/usr/bin/env node
'use strict'
// The developer's loop for the app's own renderer plugins.
//
//   npm run dev:app
//
// Starts Vite for the frontend bootstrap and a source watcher for plugins/.
// Plugin edits are staged into app data and marked pending. Reload mounts them;
// Reload on save optionally makes that automatic. Features stay runtime-loaded.
//
// A main-process plugin under `bootstrap/backend/**` has no hot loop: restart the app.
const { spawn } = require('node:child_process')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const PORT = process.env.SISYPHUS_DEV_PORT ?? '5173'
const READY = /Local:\s+http/
const READY_TIMEOUT_MS = 60_000

const npm = (args, options) => spawn('npm', args, { shell: true, cwd: ROOT, ...options })

const vite = npm(['-w', 'frontend', 'run', 'dev', '--', '--port', PORT, '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
})

let app
const sync = spawn(process.execPath, [path.join(ROOT, 'scripts', 'plugin-sync.js'), '--watch'], {
  cwd: ROOT, stdio: 'inherit', windowsHide: true,
})
let ready = false
const timer = setTimeout(() => {
  if (ready) return
  console.error(`\n  Vite did not start within ${READY_TIMEOUT_MS / 1000}s.`)
  shutdown()
}, READY_TIMEOUT_MS)

function shutdown(code = 0) {
  clearTimeout(timer)
  if (app && !app.killed) app.kill()
  if (vite && !vite.killed) vite.kill()
  if (!sync.killed) sync.kill()
  process.exit(code)
}

// Vite says when it is listening; until then the URL would open nothing.
vite.stdout.on('data', (chunk) => {
  const text = chunk.toString()
  process.stdout.write(text)
  if (ready || !READY.test(text)) return
  ready = true
  console.log(`\n  Starting the app against http://localhost:${PORT}\n`)
  app = npm(['-w', 'desktop', 'start'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: `http://localhost:${PORT}` },
  })
  app.on('exit', (code) => shutdown(code ?? 0))
})
vite.stderr.on('data', (chunk) => process.stderr.write(chunk))
vite.on('exit', (code) => {
  if (!ready) console.error(`\n  Vite exited with ${code} before it was listening.`)
  shutdown(code ?? 0)
})

process.on('SIGINT', () => shutdown(0))
console.log(`  Vite is starting on port ${PORT} (strict), then Electron will open.`)
