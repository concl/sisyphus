const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PythonHost } = require('../../../plugins/python/backend/lib/python-host.js')

function fixture() {
  const children = []
  const urls = []
  const host = new PythonHost({
    hostDir: __dirname,
    definitions: [{ id: 'test', name: 'Test', app: 'app:app' }],
    spawnFn() {
      const child = new EventEmitter()
      Object.assign(child, {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        pid: 123,
        exitCode: null,
        kill() {
          child.exitCode = 0
          child.emit('exit', 0)
        },
      })
      children.push(child)
      queueMicrotask(() => child.stdout.emit('data', 'SISYPHUS_PORT=34567\n'))
      return child
    },
    fetchFn: async (url) => {
      urls.push(url)
      return { ok: true, json: async () => ({ status: 'ok' }) }
    },
  })
  return { host, children, urls }
}
test('starts on announced port, proxies only local paths, and shuts down', async () => {
  const { host, children, urls } = fixture()
  await host.start('test')
  assert.equal(host.list()[0].state, 'running')
  assert.equal(host.list()[0].url, 'http://127.0.0.1:34567')
  await host.start('test')
  assert.equal(children.length, 1)
  assert.deepEqual(await host.call('test', '/api/info'), { status: 'ok' })
  for (const path of ['//example.com', '/\\example.com', 'https://example.com'])
    await assert.rejects(host.call('test', path))
  assert.equal(urls.at(-1), 'http://127.0.0.1:34567/api/info')
  await host.dispose()
  assert.equal(children[0].exitCode, 0)
  assert.equal(host.list()[0].state, 'stopped')
})
test('startup failure is visible and bounded logs survive stopping', async () => {
  const { host, children } = fixture()
  const start = host.start('test')
  children[0].stderr.emit('data', 'line\n'.repeat(200))
  children[0].emit('error', new Error('python missing'))
  await start
  assert.equal(host.list()[0].state, 'failed')
  assert.equal(host.list()[0].error, 'python missing')
  assert.equal(host.list()[0].logs.length, 120)
})
test('stop during startup cannot resurrect the service', async () => {
  const { host } = fixture()
  const start = host.start('test')
  await host.stop('test')
  await start
  assert.equal(host.list()[0].state, 'stopped')
})
