const { spawn } = require('node:child_process')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { createInterface } = require('node:readline')
const fs = require('node:fs')
const os = require('node:os')

// One persistent helper and one owner for the physical desktop. Calls are
// serialized even when a provider issues multiple tool calls in one step.
class WindowsDriver {
  constructor() { this.pending = null; this.child = null; this.cancelFile = path.join(os.tmpdir(), `sisyphus-computer-${randomUUID()}.cancel`) }
  start() {
    if (this.child) return
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'windows.ps1')], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    let errors = ''
    child.stderr.on('data', data => { errors = (errors + data).slice(-2000) })
    createInterface({ input: child.stdout }).on('line', line => {
      const pending = this.pending
      if (!pending) return
      try {
        const result = JSON.parse(line)
        if (result.error) pending.reject(new Error(result.error))
        else pending.resolve(result)
      } catch { pending.reject(new Error('Invalid response from desktop helper')) }
    })
    child.on('error', error => { if (this.child === child) this.pending?.reject(error) })
    child.on('exit', () => {
      if (this.child !== child) return
      this.child = null
      this.pending?.reject(new Error(errors || 'Desktop helper stopped'))
    })
  }
  call(input, signal) {
    if (signal?.aborted) return Promise.reject(new Error('Request stopped'))
    this.start()
    fs.rmSync(this.cancelFile, { force: true })
    return new Promise((resolve, reject) => {
      const finish = (fn, value) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        this.pending = null
        fn(value)
      }
      // Cooperative cancellation lets the helper release held keys/buttons in
      // finally blocks. Don't kill it halfway through a chord or drag.
      const abort = () => fs.writeFileSync(this.cancelFile, '')
      const timer = setTimeout(() => { abort(); finish(reject, new Error('Desktop helper timed out')); this.dispose() }, 30000)
      this.pending = { resolve: value => signal?.aborted ? finish(reject, new Error('Request stopped')) : finish(resolve, value), reject: error => finish(reject, error) }
      signal?.addEventListener('abort', abort, { once: true })
      this.child.stdin.write(`${JSON.stringify({ ...input, cancelFile: this.cancelFile })}\n`, error => { if (error) this.pending?.reject(error) })
    })
  }
  dispose() {
    if (!this.child) return
    fs.writeFileSync(this.cancelFile, '')
    const child = this.child
    this.child = null
    child.stdin.end()
    const timer = setTimeout(() => child.kill(), 2000)
    child.once('exit', () => { clearTimeout(timer); fs.rmSync(this.cancelFile, { force: true }) })
  }
}

class Computer {
  constructor(driver = new WindowsDriver()) {
    this.driver = driver
    this.owner = null
    this.frame = null
    this.queue = Promise.resolve()
    this.disposed = false
  }
  release(runId) {
    if (this.owner === runId) { this.owner = null; this.frame = null }
  }
  execute(action, input, context) {
    const runId = context?.runId
    if (!runId) return Promise.reject(new Error('Desktop control needs an active chat run'))
    if (this.disposed || context.signal?.aborted) return Promise.reject(new Error('Request stopped'))
    if (this.owner && this.owner !== runId) return Promise.reject(new Error('Another conversation is controlling the desktop. Stop that reply or wait for it to finish.'))
    this.owner = runId
    const result = this.queue.then(async () => {
      if (this.disposed || context.signal?.aborted || this.owner !== runId) throw new Error('Desktop session ended')
      if (action === 'release') { this.release(runId); return { released: true } }
      if (action !== 'screenshot' && (!this.frame || input.screenshotId !== this.frame.screenshotId))
        throw new Error('Screenshot is stale. Take a fresh screenshot before acting.')
      const previous = this.frame
      this.frame = null
      const output = await this.driver.call({ action, ...input, frame: previous }, context.signal)
      if (this.owner !== runId || context.signal?.aborted) throw new Error('Desktop session ended')
      const screenshotId = randomUUID()
      const { image, ...metadata } = output
      this.frame = { ...metadata, screenshotId }
      return { type: 'computer-screenshot', ...metadata, screenshotId, mediaType: 'image/png', data: image }
    })
    this.queue = result.catch(() => {})
    return result
  }
  dispose() { this.disposed = true; this.owner = null; this.frame = null; this.driver.dispose() }
}
module.exports = { Computer, WindowsDriver }
