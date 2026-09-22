'use strict'
// One-shot shell execution for the agent. Backend detection is reused from the
// terminal block so the agent runs commands in the same shell the user sees.
const { spawn } = require('node:child_process')
const os = require('node:os')
const path = require('node:path')

const DEFAULT_TIMEOUT = 120000
const MAX_TIMEOUT = 600000
const MAX_OUTPUT = 40000

// Interactive shells need different flags to run a single command and exit.
function oneShotArgs(backend, command) {
  switch (backend.id) {
    case 'powershell':
    case 'pwsh':
      return ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]
    case 'cmd':
      return ['/d', '/s', '/c', command]
    case 'wsl':
      return [...backend.args, 'bash', '-lc', command]
    default:
      return ['-c', command]
  }
}

function truncate(text, limit = MAX_OUTPUT) {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n… truncated ${text.length - limit} characters`
}

// Render one run as the text the model reads back.
function formatResult({ command, exitCode, stdout, stderr, timedOut, timeoutMs }) {
  const lines = [`$ ${command}`]
  if (timedOut) lines.push(`Timed out after ${timeoutMs}ms and was stopped.`)
  else lines.push(`Exit code: ${exitCode}`)
  const out = truncate(stdout.trimEnd())
  const err = truncate(stderr.trimEnd())
  lines.push(out ? `stdout:\n${out}` : 'stdout: (empty)')
  if (err) lines.push(`stderr:\n${err}`)
  return lines.join('\n\n')
}

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    killer.on('error', () => child.kill())
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

// Runs a command in its own process group so a timeout or a stop request kills
// the whole tree, and resolves (never rejects) with the captured result.
function runCommand({ command, cwd, timeoutMs, backend, signal, spawnImpl = spawn }) {
  const limit = Math.min(
    Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT,
    MAX_TIMEOUT,
  )
  return new Promise((resolve, reject) => {
    const child = spawnImpl(backend.command, oneShotArgs(backend, command), {
      cwd,
      windowsHide: true,
      env: { ...process.env },
      detached: process.platform !== 'win32',
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const keep = (current, chunk) =>
      current.length > MAX_OUTPUT * 2 ? current : current + chunk.toString()
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      resolve(result)
    }
    const stop = () => killTree(child)
    const timer = setTimeout(() => {
      timedOut = true
      stop()
    }, limit)
    child.stdout?.on('data', (chunk) => {
      stdout = keep(stdout, chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr = keep(stderr, chunk)
    })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      reject(error)
    })
    child.once('close', (exitCode) =>
      finish({ command, exitCode, stdout, stderr, timedOut, timeoutMs: limit }),
    )
    if (signal) {
      if (signal.aborted) stop()
      else signal.addEventListener('abort', stop, { once: true })
    }
  })
}

function defaultBackend() {
  // The default does not require enumerating WSL and every installed shell.
  if (process.platform === 'win32') return { id: 'powershell', name: 'PowerShell', command: 'powershell.exe', args: [] }
  const command = process.env.SHELL || os.userInfo().shell || '/bin/sh'
  return { id: path.basename(command), name: path.basename(command), command, args: [] }
}

module.exports = {
  runCommand,
  formatResult,
  oneShotArgs,
  truncate,
  defaultBackend,
  DEFAULT_TIMEOUT,
  MAX_TIMEOUT,
  MAX_OUTPUT,
}
