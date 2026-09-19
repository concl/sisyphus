const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  runCommand,
  formatResult,
  oneShotArgs,
  truncate,
  defaultBackend,
  MAX_OUTPUT,
} = require('../../../plugins/shell/native/lib/shell-run.js')

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-shell-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return fs.realpathSync(dir)
}

function context(services) {
  return {
    get: (name) => services[name],
    effect: (fn) => {
      fn()
    },
  }
}

function registry() {
  const tools = new Map()
  return {
    register: (name, definition) => {
      tools.set(name, definition)
      return () => tools.delete(name)
    },
    get: (name) => tools.get(name),
  }
}

test('each shell backend gets the flags for a single command', () => {
  assert.deepEqual(oneShotArgs({ id: 'powershell' }, 'echo hi'), [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'echo hi',
  ])
  assert.deepEqual(oneShotArgs({ id: 'cmd' }, 'echo hi'), ['/d', '/s', '/c', 'echo hi'])
  assert.deepEqual(oneShotArgs({ id: 'gitbash' }, 'echo hi'), ['-c', 'echo hi'])
  assert.deepEqual(oneShotArgs({ id: 'wsl', args: ['-d', 'Ubuntu'] }, 'echo hi'), [
    '-d',
    'Ubuntu',
    'bash',
    '-lc',
    'echo hi',
  ])
  assert.deepEqual(oneShotArgs({ id: 'bash' }, 'echo hi'), ['-c', 'echo hi'])
})

test('truncate marks clipped output', () => {
  assert.equal(truncate('short'), 'short')
  const clipped = truncate('x'.repeat(MAX_OUTPUT + 10))
  assert.ok(clipped.length < MAX_OUTPUT + 100)
  assert.match(clipped, /truncated 10 characters/)
})

test('formatResult reports the command, exit code, and streams', () => {
  const text = formatResult({
    command: 'ls',
    exitCode: 1,
    stdout: 'out\n',
    stderr: 'boom\n',
    timedOut: false,
  })
  assert.match(text, /\$ ls/)
  assert.match(text, /Exit code: 1/)
  assert.match(text, /stdout:\nout/)
  assert.match(text, /stderr:\nboom/)
  const timed = formatResult({
    command: 'sleep',
    exitCode: null,
    stdout: '',
    stderr: '',
    timedOut: true,
    timeoutMs: 50,
  })
  assert.match(timed, /Timed out after 50ms/)
  assert.match(timed, /stdout: \(empty\)/)
})

test('runCommand captures a real command in the folder', async (t) => {
  const dir = workspace(t)
  const result = await runCommand({ command: 'echo hello', cwd: dir, backend: defaultBackend() })
  assert.equal(result.exitCode, 0)
  assert.match(result.stdout, /hello/)
  assert.match(formatResult(result), /hello/)
})

test('the shell plugin keeps commands inside the conversation folder', async (t) => {
  const dir = workspace(t)
  const tools = registry()
  require('../../../plugins/shell/native/shell.js')().apply(context({ 'agent.tools.v1': tools }))
  const run = tools.get('run_command')
  assert.equal(run.access, 'write')
  await assert.rejects(() => run.execute({ command: 'echo hi' }, {}), /no folder/)
  await assert.rejects(
    () => run.execute({ command: 'echo hi', cwd: '..' }, { folder: dir }),
    /outside this conversation folder/,
  )
  const output = await run.execute({ command: 'echo hi' }, { folder: dir })
  assert.match(output, /Exit code: 0/)
  assert.match(output, /hi/)
})
