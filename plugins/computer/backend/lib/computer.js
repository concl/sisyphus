const { spawn } = require('node:child_process')
const path = require('node:path')
const { randomUUID, createHash } = require('node:crypto')
const { createInterface } = require('node:readline')
const { setTimeout: sleep } = require('node:timers/promises')
const fs = require('node:fs')
const os = require('node:os')

function helperCommand(platform, env = process.env) {
  if (platform === 'win32') return {
    command: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'windows.ps1')],
  }
  if (!['darwin', 'linux'].includes(platform)) throw new Error(`Desktop control does not support ${platform}.`)
  if (platform === 'linux' && (env.XDG_SESSION_TYPE === 'wayland' || env.WAYLAND_DISPLAY))
    throw new Error('This desktop backend supports Linux X11, not Wayland. Use an X11 session; a Wayland portal backend is not implemented.')
  return { command: env.SISYPHUS_COMPUTER_PYTHON || 'python3', args: ['-u', path.join(__dirname, 'portable.py')] }
}

// Each helper process owns its cancellation flag. Late output from a retired
// process cannot satisfy a request sent to its replacement.
class HelperDriver {
  constructor(platform = process.platform) { this.platform = platform; this.session = null }
  start() {
    if (this.session) return this.session
    const { command, args } = helperCommand(this.platform)
    const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const session = { child, pending: null, cancelFile: path.join(os.tmpdir(), `sisyphus-computer-${randomUUID()}.cancel`) }
    this.session = session
    let errors = ''
    child.stderr.on('data', data => { errors = (errors + data).slice(-2000) })
    child.stdin.on('error', error => session.pending?.reject(error))
    createInterface({ input: child.stdout }).on('line', line => {
      const pending = session.pending
      if (!pending) return
      try {
        const result = JSON.parse(line)
        if (result.error) pending.reject(new Error(result.error))
        else pending.resolve(result)
      } catch { pending.reject(new Error('Invalid response from desktop helper')) }
    })
    child.on('error', error => {
      if (this.session === session) this.session = null
      session.pending?.reject(new Error(`Cannot start desktop helper (${command}): ${error.message}. On macOS/Linux install Python 3 and the computer plugin's requirements.txt, or set SISYPHUS_COMPUTER_PYTHON.`))
    })
    child.on('exit', () => {
      if (this.session === session) this.session = null
      session.pending?.reject(new Error(errors || 'Desktop helper stopped'))
      fs.rmSync(session.cancelFile, { force: true })
    })
    return session
  }
  call(input, signal) {
    if (signal?.aborted) return Promise.reject(new Error('Request stopped'))
    const session = this.start()
    if (session.pending) return Promise.reject(new Error('Desktop helper is busy'))
    fs.rmSync(session.cancelFile, { force: true })
    return new Promise((resolve, reject) => {
      let finished = false
      const finish = (fn, value) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        session.pending = null
        fn(value)
      }
      const abort = () => fs.writeFileSync(session.cancelFile, '')
      const timer = setTimeout(() => {
        abort()
        finish(reject, new Error('Desktop helper timed out; input may have been sent. Observe the desktop before retrying.'))
        if (this.session === session) this.dispose()
      }, 30000)
      session.pending = {
        resolve: value => signal?.aborted ? finish(reject, new Error('Request stopped')) : finish(resolve, value),
        reject: error => finish(reject, error),
      }
      signal?.addEventListener('abort', abort, { once: true })
      session.child.stdin.write(`${JSON.stringify({ ...input, cancelFile: session.cancelFile })}\n`, error => { if (error) session.pending?.reject(error) })
    })
  }
  dispose() {
    const session = this.session
    if (!session) return
    this.session = null
    fs.writeFileSync(session.cancelFile, '')
    session.child.stdin.end()
    const timer = setTimeout(() => session.child.kill(), 2000)
    session.child.once('exit', () => clearTimeout(timer))
  }
}
class WindowsDriver extends HelperDriver { constructor() { super('win32') } }
const digest = image => createHash('sha256').update(image).digest('hex')
const verificationHint = 'Input delivery and unchanged/stable pixels do NOT prove the intended action succeeded. Identify visible evidence for the expected effect. If a menu is absent, navigation is pending, or the result is ambiguous, use computer_wait and inspect again before acting or claiming success. Never treat expectedEffect as an observed result.'

class Computer {
  constructor(driver = new HelperDriver(), { delay = (ms, signal) => sleep(ms, undefined, { signal }) } = {}) {
    this.driver = driver
    this.delay = delay
    this.owner = null
    this.frame = null
    this.digest = null
    this.display = 0
    this.queue = Promise.resolve()
    this.controller = new AbortController()
  }
  release(runId) {
    if (this.owner === runId) { this.owner = null; this.frame = null; this.digest = null; this.display = 0 }
  }
  execute(action, input, context) {
    const runId = context?.runId
    if (!runId) return Promise.reject(new Error('Desktop control needs an active chat run'))
    const signal = AbortSignal.any([this.controller.signal, ...(context.signal ? [context.signal] : [])])
    if (signal.aborted) return Promise.reject(new Error('Request stopped'))
    if (this.owner && this.owner !== runId) return Promise.reject(new Error('Another conversation is controlling the desktop. Stop that reply or wait for it to finish.'))
    this.owner = runId
    const result = this.queue.then(async () => {
      if (signal.aborted || this.owner !== runId) throw new Error('Desktop session ended')
      if (action === 'release') { this.release(runId); return { released: true } }
      const observing = action === 'screenshot' || action === 'wait'
      if (!observing && (!this.frame || input.screenshotId !== this.frame.screenshotId))
        throw new Error('Screenshot is stale. Take a fresh screenshot before acting.')
      const previous = this.frame
      const previousDigest = this.digest
      this.frame = null
      let sent = false
      let output, matchingSamples = null
      const waitMs = action === 'screenshot' ? 0 : (input.waitMs ?? (action === 'wait' ? 1500 : 800))
      let releasedAt = Date.now()
      try {
        if (!observing) {
          await this.driver.call({ action, ...input, durationMs: input.durationMs ?? 50, frame: previous, capture: false }, signal)
          sent = true
          releasedAt = Date.now()
        }
        if (waitMs) await this.delay(waitMs, signal)
        const capture = () => this.driver.call({ action: 'screenshot', display: input.display ?? this.display }, signal)
        output = await capture()
        // Identical samples are not evidence of network or semantic success.
        if (waitMs) {
          await this.delay(250, signal)
          const next = await capture()
          matchingSamples = digest(output.image) === digest(next.image)
          output = next
        }
        if (typeof output?.image !== 'string' || !output.image) throw new Error('Desktop helper returned no screenshot')
      } catch (error) {
        if (sent) throw new Error(`Input was sent, but observation failed: ${error.message}. Take a screenshot before retrying the action.`)
        throw error
      }
      if (this.owner !== runId || signal.aborted) throw new Error('Desktop session ended')
      const screenshotId = randomUUID()
      const { image, ...metadata } = output
      const currentDigest = digest(image)
      const sameDisplay = previous && previous.display === metadata.display && previous.left === metadata.left && previous.top === metadata.top && previous.screenWidth === metadata.screenWidth && previous.screenHeight === metadata.screenHeight
      this.frame = { ...metadata, screenshotId }
      this.display = metadata.display
      this.digest = currentDigest
      return {
        type: 'computer-screenshot', ...metadata, screenshotId, mediaType: 'image/png', data: image,
        actionStatus: sent ? 'input-sent' : 'observed', outcome: 'unverified',
        expectedEffect: input.expectedEffect,
        observation: { capturedAt: new Date().toISOString(), waitedMs: Date.now() - releasedAt,
          visualChange: !sameDisplay || !previousDigest ? 'unknown' : currentDigest === previousDigest ? 'not-detected' : 'detected',
          matchingSamples, sampleIntervalMs: waitMs ? 250 : null, verificationHint },
      }
    })
    this.queue = result.catch(() => {})
    return result
  }
  dispose() { this.controller.abort(); this.owner = null; this.frame = null; this.driver.dispose() }
}
module.exports = { Computer, WindowsDriver, HelperDriver, helperCommand }
