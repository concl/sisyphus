'use strict'
// Supervisor for a managed service: the python-host FastAPI app. Pure Node
// (no Electron); spawn and fetch are injectable for unit tests.
const path = require('node:path')

const DEFAULT_PORT = 8765
const SERVICE_NAME = 'python-host'

function resolvePythonBin(hostDir) {
  if (process.env.SISYPHUS_PYTHON) return process.env.SISYPHUS_PYTHON
  const rel = process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']
  return path.join(hostDir, '.venv', ...rel)
}

class ServiceSupervisor {
  constructor({ hostDir, port = DEFAULT_PORT, spawnFn, fetchFn, log = () => {} } = {}) {
    this.hostDir = hostDir
    this.port = port
    this.spawnFn = spawnFn || require('node:child_process').spawn
    this.fetchFn = fetchFn || globalThis.fetch
    this.log = log
    this.child = null
    this.lastError = null
    this.lastCheck = null
  }

  get url() {
    return `http://127.0.0.1:${this.port}`
  }

  get running() {
    return this.child !== null && this.child.exitCode === null && !this.child.killed
  }

  start() {
    if (this.running) return
    const python = resolvePythonBin(this.hostDir)
    this.child = this.spawnFn(
      python,
      ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(this.port)],
      { cwd: this.hostDir, stdio: 'ignore', windowsHide: true },
    )
    this.lastError = null
    this.log(`[service] spawning ${python} (pid ${this.child.pid ?? '?'})`)
    this.child.on('exit', (code) => {
      this.log(`[service] exited (code ${code})`)
      this.child = null
    })
    this.child.on('error', (err) => {
      this.lastError = err.message
    })
  }

  stop() {
    if (this.child) {
      this.child.kill()
      this.child = null
    }
  }

  // Polls the service's /health endpoint; returns whether it is healthy.
  async health() {
    if (!this.running) {
      this.lastCheck = { ok: false, error: 'not running' }
      return false
    }
    try {
      const res = await this.fetchFn(`${this.url}/health`, { signal: AbortSignal.timeout(2000) })
      const body = await res.json().catch(() => null)
      this.lastCheck = { ok: res.ok && body?.status === 'ok' }
      return this.lastCheck.ok
    } catch (err) {
      this.lastCheck = { ok: false, error: err.message }
      return false
    }
  }

  async status() {
    const healthy = await this.health()
    return {
      id: SERVICE_NAME,
      name: SERVICE_NAME,
      running: this.running,
      pid: this.child ? this.child.pid : undefined,
      url: this.url,
      healthy,
      error: this.running ? this.lastCheck?.error ?? undefined : (this.lastError ?? 'not running'),
    }
  }
}

module.exports = { ServiceSupervisor, DEFAULT_PORT, SERVICE_NAME, resolvePythonBin }
