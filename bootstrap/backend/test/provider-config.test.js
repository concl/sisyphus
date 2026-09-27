const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { ProviderChatConfig } = require('../../../plugins/chat/backend/lib/provider-config')
const { DEFAULT_PROMPT } = require('../../../plugins/chat/backend/lib/chat-config')
const { WorkerChat } = require('../../../plugins/chat/backend/worker-client')
const { createWorker } = require('../lib/plugin-compiler')
const mockModel = require('../smoke/mock-model')

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-providers-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const values = new Map()
  const storage = {
    get: (scope, key) => structuredClone(values.get(`${scope}:${key}`)),
    set: (scope, key, value) => values.set(`${scope}:${key}`, structuredClone(value)),
  }
  storage.set('chat.config', 'provider.v1', {
    baseURL: 'https://original.example/v1',
    model: 'old-model',
    systemPrompt: DEFAULT_PROMPT,
    access: 'none',
  })
  const secrets = { has: () => true, read: () => 'encrypted-old-key' }
  const file = path.join(directory, 'chat.providers.json')
  const config = new ProviderChatConfig(storage, secrets, file)
  const save = (providers) => config.saveProviders({ text: JSON.stringify({ providers }) })
  return { config, save, file, storage, secrets, directory }
}

test('migration preserves the model and encrypted key, scoped to the original endpoint', (t) => {
  const { config, save, file } = fixture(t)
  assert.equal(config.resolve().model, 'old-model')
  assert.equal(config.resolve().apiKey, 'encrypted-old-key')
  assert(!fs.readFileSync(file, 'utf8').includes('encrypted-old-key'))
  const original = JSON.parse(config.document().text).providers
  save([...original, { id: 'other', baseURL: 'https://other.example/v1', models: ['old-model'] }])
  config.select({ provider: 'other', model: 'old-model' })
  assert.equal(config.resolve().apiKey, undefined)
  config.save({ systemPrompt: 'Custom prompt', access: 'read', limits: config.get().limits })
  config.select({ provider: 'default', model: 'old-model' })
  assert.equal(config.resolve().apiKey, 'encrypted-old-key')
  save([{ ...original[0], baseURL: 'https://new.example/v1' }])
  assert.equal(config.resolve().apiKey, undefined)
  save([{ ...original[0], apiKey: '' }])
  assert.equal(config.resolve().apiKey, undefined)
})

test('selection survives restart and provider keys never appear in public config', (t) => {
  const { config, save, file, storage, secrets } = fixture(t)
  save([
    { id: 'first', baseURL: 'https://one.example/v1', apiKey: 'first-secret', models: ['same'] },
    {
      id: 'second',
      baseURL: 'http://localhost:1234/v1/',
      apiKey: 'second-secret',
      models: ['same', 'other'],
    },
  ])
  config.select({ provider: 'second', model: 'same' })
  const reopened = new ProviderChatConfig(storage, secrets, file)
  assert.equal(reopened.resolve().baseURL, 'http://localhost:1234/v1')
  assert.equal(reopened.resolve().apiKey, 'second-secret')
  assert.equal(reopened.get().provider, 'second')
  assert.equal(reopened.get().hasApiKey, true)
  assert(!JSON.stringify(reopened.get()).includes('secret'))
  assert.throws(() => config.select({ provider: 'first', model: 'other' }), /no longer configured/)
  assert.equal(config.get().provider, 'second')
})

test('invalid edits preserve the file; external changes and removed selections are handled', (t) => {
  const { config, save, file } = fixture(t)
  const before = config.document().text
  for (const text of ['{"apiKey":"private', '{}', '{"providers":[{"id":"a"}]}']) {
    assert.throws(() => config.saveProviders({ text }))
    assert.equal(config.document().text, before)
  }
  const provider = { id: 'a', baseURL: 'https://one.example/v1', models: ['one'] }
  assert.throws(() => save([provider, provider]), /unique/)
  assert.throws(() => save([{ ...provider, models: ['one', 'one'] }]), /unique/)
  assert.throws(() => save([{ ...provider, baseURL: 'http://remote.example/v1' }]), /HTTPS/)
  assert.throws(() => save([{ ...provider, apiKey: 123 }]), /apiKey/)
  save([provider])
  config.select({ provider: 'a', model: 'one' })
  fs.writeFileSync(file, JSON.stringify({ providers: [{ ...provider, models: ['two'] }] }))
  assert.equal(config.get().model, '')
  assert.throws(() => config.resolve(), /Choose a configured model/)
  config.select({ provider: 'a', model: 'two' })
  assert.equal(config.resolve().model, 'two')
  fs.writeFileSync(file, '{"apiKey":"private')
  assert.match(config.get().providerError, /valid JSON/)
  assert(!config.get().providerError.includes('private'))
  assert.throws(() => config.resolve(), /valid JSON/)
  save([])
  assert.equal(config.get().model, '')
})

test('worker sends each model to its provider with the correct optional credential', async (t) => {
  const first = await mockModel()
  const second = await mockModel()
  const { config, save, directory } = fixture(t)
  save([
    { id: 'first', baseURL: first.baseURL, apiKey: 'first-key', models: ['first-model'] },
    { id: 'second', baseURL: second.baseURL, models: ['second-model'] },
  ])
  const chat = new WorkerChat({
    workers: { create: createWorker },
    directory: path.join(directory, 'history'),
    config,
    registry: { list: () => [] },
  })
  try {
    config.select({ provider: 'first', model: 'first-model' })
    const conversation = await chat.send({ runId: 'first', text: 'think' }, 1, () => {})
    config.select({ provider: 'second', model: 'second-model' })
    await chat.send(
      { runId: 'second', conversationId: conversation.id, text: 'think again' },
      1,
      () => {},
    )
    assert.equal(first.requests[0].body.model, 'first-model')
    assert.equal(first.requests[0].authorization, 'Bearer first-key')
    assert.equal(second.requests[0].body.model, 'second-model')
    assert.equal(second.requests[0].authorization, undefined)
  } finally {
    await Promise.all([chat.dispose(), first.close(), second.close()])
  }
})
