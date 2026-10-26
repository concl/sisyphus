#!/usr/bin/env node
// Start the desktop app from this checkout.
//
// Two host artifacts can stop Electron before any app code runs, and neither is
// a build error:
//
//  * A sandboxed workspace can inherit a Low integrity label on the files under
//    node_modules. Electron 43 then aborts with STATUS_BREAKPOINT
//    (0x80000003, reported by the wrappers as exit 2147483651), because
//    Chromium cannot start its browser process from a low-integrity executable.
//    Raising just electron.exe lets the window process start but leaves the GPU
//    and renderer children dying, so the whole runtime tree is raised together.
//    This restores the sandbox instead of disabling it.
//  * A parent Electron process (an agent host) may export
//    ELECTRON_RUN_AS_NODE=1. That runs electron.exe as plain Node, where
//    require('electron').app is undefined, and the app exits immediately.
//    Clearing it for the child makes a launch from such a host behave like a
//    launch from Explorer.
//
// If the label cannot be repaired, the app still starts, with --no-sandbox and
// a warning, rather than failing at the same opaque exit code.
//
// `node scripts/desktop-launch.mjs --prepare` only checks and repairs the
// runtime, then exits; it is useful from an install hook or a shell.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const backend = path.join(root, 'bootstrap', 'backend')
const prepare = process.argv.includes('--prepare')

/** The Electron executable this checkout installed, wherever npm hoisted it. */
function electronBinary() {
  const require = createRequire(path.join(backend, 'package.json'))
  return require('electron')
}

function isLow(file) {
  try {
    const acl = execFileSync('icacls', [file], { encoding: 'utf8', windowsHide: true })
    return /Mandatory Label\\Low Mandatory Level/.test(acl)
  } catch {
    return false
  }
}

/** True when the runtime can start with Chromium's sandbox left on. */
function ensureRuntime() {
  if (process.platform !== 'win32') return true
  let binary
  try {
    binary = electronBinary()
  } catch {
    // Let the spawn below report a missing install in its own words.
    return true
  }
  if (!fs.existsSync(binary)) return true
  const dist = path.dirname(binary)
  // electron.exe is what determines the browser process's integrity; a DLL is
  // what the GPU/renderer children load. A half-repaired tree has one Low.
  const probes = [binary, path.join(dist, 'ffmpeg.dll')].filter((file) => fs.existsSync(file))
  if (!probes.some(isLow)) return true
  try {
    execFileSync('icacls', [dist, '/setintegritylevel', 'Medium', '/T', '/C', '/Q'], {
      stdio: 'inherit',
      windowsHide: true,
    })
    console.log('[desktop] Electron runtime had a Low integrity label; restored Medium integrity.')
  } catch (error) {
    console.error(`[desktop] Could not repair the Electron runtime label: ${error.message}`)
  }
  return !probes.some(isLow)
}

const sandboxed = ensureRuntime()
if (prepare) process.exit(sandboxed ? 0 : 1)

let binary
try {
  binary = electronBinary()
} catch (error) {
  console.error(`[desktop] Electron is not installed: ${error.message}`)
  process.exit(1)
}

const env = { ...process.env }
// A host Electron sets this for its own child processes; it must not reach the
// app we are launching.
delete env.ELECTRON_RUN_AS_NODE
const args = ['.', ...process.argv.slice(2).filter((arg) => arg !== '--prepare')]
if (!sandboxed) {
  args.push('--no-sandbox')
  console.warn(
    '[desktop] Starting without Chromium sandbox because the Electron runtime is still low-integrity.',
  )
}
const child = spawn(binary, args, { cwd: backend, stdio: 'inherit', env })
child.on('error', (error) => {
  console.error(`[desktop] Could not start Electron: ${error.message}`)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
