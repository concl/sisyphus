const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

/** Configured Python servers, each owning a loopback socket and process. */
class PythonHost {
  constructor({ hostDir, spawnFn = spawn, fetchFn = globalThis.fetch, definitions } = {}) {
    this.hostDir = hostDir
    this.spawnFn = spawnFn
    this.fetchFn = fetchFn
    const config =
      definitions ?? JSON.parse(fs.readFileSync(path.join(hostDir, 'servers.json'), 'utf8'))
    this.entries = new Map()
    for (const definition of config) {
      if (
        !/^[a-z0-9-]+$/.test(definition.id) ||
        this.entries.has(definition.id) ||
        typeof definition.app !== 'string'
      )
        throw new Error('Invalid Python server definition')
      this.entries.set(definition.id, {
        definition,
        child: null,
        state: 'stopped',
        logs: [],
        token: null,
      })
    }
  }
  entry(id) {
    const entry = this.entries.get(id)
    if (!entry) throw new Error(`Unknown Python server: ${id}`)
    return entry
  }
  list() {
    return [...this.entries.values()].map((entry) => ({
      id: entry.definition.id,
      name: entry.definition.name,
      state: entry.state,
      pid: entry.child?.pid,
      url: entry.url,
      error: entry.error,
      logs: [...entry.logs],
    }))
  }
  log(entry, text) {
    entry.logs.push(...String(text).trimEnd().split(/\r?\n/))
    entry.logs = entry.logs.slice(-120)
  }
  async start(id) {
    const entry = this.entry(id)
    if (entry.child || entry.starting) return this.list()
    entry.starting = true
    entry.state = 'starting'
    entry.error = undefined
    entry.url = undefined
    const token = (entry.token = Symbol(id))
    try {
      const python =
        process.env.SISYPHUS_PYTHON ||
        path.join(
          this.hostDir,
          '.venv',
          process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
        )
      const child = this.spawnFn(python, ['-u', 'runner.py', entry.definition.app], {
        cwd: this.hostDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      })
      entry.child = child
      let buffer = ''
      child.stdout.on('data', (chunk) => {
        if (entry.token !== token) return
        buffer += chunk.toString()
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop().slice(-8192)
        for (const line of lines) {
          this.log(entry, line)
          const match = /^SISYPHUS_PORT=(\d+)$/.exec(line)
          if (match && Number(match[1]) > 0 && Number(match[1]) <= 65535)
            entry.url = `http://127.0.0.1:${match[1]}`
        }
      })
      child.stderr.on('data', (chunk) => {
        if (entry.token === token) this.log(entry, chunk)
      })
      child.once('error', (error) => {
        if (entry.token !== token) return
        entry.error = error.message
        entry.state = 'failed'
        entry.child = null
      })
      child.once('exit', (code) => {
        if (entry.token !== token) return
        entry.child = null
        entry.state = 'failed'
        entry.error ??= `Server exited (${code})`
      })
      const deadline = Date.now() + 15000
      while (entry.token === token && entry.child && Date.now() < deadline) {
        if (entry.url) {
          try {
            const response = await this.fetchFn(
              entry.url + (entry.definition.health ?? '/health'),
              { signal: AbortSignal.timeout(800), redirect: 'error' },
            )
            if (entry.token !== token) break
            if (response.ok) {
              entry.state = 'running'
              return this.list()
            }
          } catch {
            /* wait for ASGI startup */
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      if (entry.token === token && entry.state !== 'failed') {
        await this.stop(id)
        entry.state = 'failed'
        entry.error = 'Server did not become healthy within 15 seconds'
      }
    } catch (error) {
      if (entry.token === token) {
        entry.error = error.message
        entry.state = 'failed'
      }
    } finally {
      entry.starting = false
    }
    return this.list()
  }
  async stop(id) {
    const entry = this.entry(id)
    entry.token = null
    const child = entry.child
    entry.child = null
    entry.url = undefined
    entry.state = 'stopped'
    entry.error = undefined
    if (!child || child.exitCode !== null) return this.list()
    await new Promise((resolve) => {
      let timer
      const done = () => {
        clearTimeout(timer)
        resolve()
      }
      child.once('exit', done)
      child.once('error', done)
      timer = setTimeout(() => {
        child.kill('SIGKILL')
        done()
      }, 2000)
      child.kill()
    })
    return this.list()
  }
  async call(id, requestPath) {
    const entry = this.entry(id)
    if (entry.state !== 'running' || !entry.url) throw new Error('Server is not running')
    if (
      typeof requestPath !== 'string' ||
      !requestPath.startsWith('/') ||
      requestPath.startsWith('//') ||
      requestPath.includes('\\')
    )
      throw new Error('Expected a local API path')
    const url = new URL(requestPath, entry.url)
    if (url.origin !== entry.url) throw new Error('Invalid API origin')
    const response = await this.fetchFn(url.href, {
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }
  async dispose() {
    await Promise.all([...this.entries.keys()].map((id) => this.stop(id)))
  }
}
module.exports = { PythonHost }
