'use strict'
const { spawn } = require('node:child_process')
function processRun(config, { signal, log }, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Cancelled'))
    const child = spawnProcess(config.program, config.args ?? [], {
      cwd: config.cwd || undefined,
      shell: false,
      windowsHide: true,
      detached: config.detach === true,
      stdio: config.detach ? 'ignore' : ['pipe', 'pipe', 'pipe'],
    })
    let settled = false
    let stdout = ''
    let stderr = ''
    let timeout
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      error ? reject(error) : resolve({ stdout, stderr, exitCode: config.detach ? null : 0 })
    }
    const kill = () => {
      if (!child.pid) return
      if (process.platform === 'win32') {
        const killer = spawnProcess('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        })
        killer.on('error', () => child.kill())
        killer.once('exit', (code) => {
          if (code !== 0) child.kill()
        })
      } else child.kill('SIGTERM')
    }
    const abort = () => {
      kill()
      finish(new Error('Cancelled'))
    }
    signal.addEventListener('abort', abort, { once: true })
    child.once('error', finish)
    child.stdin?.on('error', (error) => {
      if (error.code !== 'EPIPE') finish(error)
    })
    child.stdin?.end(config.stdin ?? '')
    child.stdout?.on('data', (chunk) => {
      stdout = (stdout + chunk.toString()).slice(-32000)
      log(chunk.toString())
    })
    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-32000)
      log(chunk.toString())
    })
    child.once('spawn', () => {
      if (config.detach) {
        child.unref()
        log('Program started.\n')
        finish()
      }
    })
    child.once('close', (code, termination) =>
      finish(
        code === 0 ? undefined : new Error(`Program exited with ${termination || `code ${code}`}`),
      ),
    )
    if (!config.detach)
      timeout = setTimeout(
        () => {
          kill()
          finish(new Error('Program timed out'))
        },
        (config.timeoutSeconds ?? 300) * 1000,
      )
    if (signal.aborted) abort()
  })
}

module.exports = { processRun }
