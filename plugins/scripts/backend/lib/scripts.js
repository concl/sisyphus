'use strict'
const path = require('node:path')
const { processRun } = require('@sisyphus/native/process-run')

function validateProgram(input) {
  for (const key of ['program', 'cwd', 'stdin']) {
    const value = input[key] ?? ''
    if (
      typeof value !== 'string' ||
      value.includes('\0') ||
      value.length > (key === 'stdin' ? 1048576 : 4096)
    )
      throw new Error(`Invalid ${key}`)
  }
  if (!input.program?.trim()) throw new Error('Choose a program or interpreter')
  if (input.cwd && !path.isAbsolute(input.cwd))
    throw new Error('Working folder needs an absolute path')
  if (
    !Array.isArray(input.args ?? []) ||
    (input.args ?? []).length > 64 ||
    (input.args ?? []).some(
      (value) => typeof value !== 'string' || value.includes('\0') || value.length > 4096,
    )
  )
    throw new Error('Use a list of arguments')
  if (input.detach !== undefined && typeof input.detach !== 'boolean')
    throw new Error('Invalid launch mode')
  const timeout = input.timeoutSeconds ?? 300
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 86400)
    throw new Error('Timeout must be between 1 and 86,400 seconds')
  if (input.detach && input.stdin) throw new Error('Detached programs cannot receive input')
}
function validateScript(input) {
  validateProgram({ ...input, program: input.interpreter })
  if (
    typeof input.path !== 'string' ||
    !path.isAbsolute(input.path) ||
    input.path.includes('\0') ||
    input.path.length > 4096
  )
    throw new Error('Choose an absolute script path')
  validateProgram({
    ...input,
    program: input.interpreter,
    args: [input.path, ...(input.args ?? [])],
  })
}
class Scripts {
  constructor(runProcess = processRun) {
    this.runProcess = runProcess
    this.controller = new AbortController()
  }
  dispose() {
    this.controller.abort()
  }
  run(input, context = {}) {
    validateProgram(input)
    const signal = context.signal
      ? AbortSignal.any([this.controller.signal, context.signal])
      : this.controller.signal
    signal.throwIfAborted()
    return this.runProcess(input, { log() {}, ...context, signal })
  }
  runScript(input, context) {
    validateScript(input)
    return this.run(
      { ...input, program: input.interpreter, args: [input.path, ...(input.args ?? [])] },
      context,
    )
  }
}
module.exports = { Scripts, validateProgram, validateScript }
