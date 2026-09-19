const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { ChatConfig, DEFAULT_PROMPT, validateBaseURL } = require('../lib/chat-config')
const { ChatService } = require('../lib/chat-service')
const { PlannerRepository, createSchema } = require('../lib/planner-data')
const mockModel = require('../smoke/mock-model')

function memory() {
  const data = new Map()
  return {
    get: (scope, key) => structuredClone(data.get(`${scope}:${key}`)),
    set: (scope, key, value) => data.set(`${scope}:${key}`, structuredClone(value)),
  }
}
function fixture(baseURL, access = 'write', toolOverride = null) {
  const storage = memory()
  let secret
  const config = new ChatConfig(storage, {
    has: () => !!secret,
    read: () => secret,
    write: (value) => {
      secret = value
    },
    clear: () => {
      secret = undefined
    },
  })
  config.save({
    baseURL,
    model: 'test-model',
    systemPrompt: DEFAULT_PROMPT,
    access,
    apiKey: 'test-key',
  })
  const planner = new PlannerRepository(storage)
  const definition = toolOverride ?? {
    name: 'create_planner_item',
    description: 'Create a task',
    access: 'write',
    inputSchema: createSchema,
    execute: (input) => planner.create(input),
  }
  const registry = { list: () => [definition] }
  return { storage, config, planner, chat: new ChatService({ storage, config, registry }) }
}

test('AI SDK streams a real compatible protocol and executes a planner tool', async () => {
  const server = await mockModel()
  try {
    const { chat, planner } = fixture(server.baseURL)
    const events = []
    const result = await chat.send({ runId: 'run-1', text: 'Create a task' }, 1, (event) =>
      events.push(event),
    )
    assert.equal(result.messages.at(-1).status, 'complete', JSON.stringify(result))
    assert.match(result.messages.at(-1).text, /Created the task/)
    assert.equal(planner.list()[0].title, 'Agent-created task')
    assert.equal(server.requests.length, 2)
    assert.equal(server.requests[0].url, '/v1/chat/completions')
    assert.equal(server.requests[0].authorization, 'Bearer test-key')
    assert.ok(events.some((event) => event.type === 'text'))
    assert.ok(events.some((event) => event.type === 'tool' && event.tool.status === 'complete'))
    assert.equal(chat.get(result.id).messages.length, 2)
  } finally {
    await server.close()
  }
})

test('tools run inside the conversation folder and log their output', async () => {
  const server = await mockModel()
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-chat-'))
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-chat-'))
  try {
    const seen = []
    const { chat } = fixture(server.baseURL, 'write', {
      name: 'create_planner_item',
      description: 'Create a task',
      access: 'write',
      inputSchema: createSchema,
      execute: (input, context) => {
        seen.push(context)
        return 'record created'
      },
    })
    const thread = await chat.send(
      { runId: 'run-folder', text: 'Create a task', folder },
      1,
      () => {},
    )
    assert.equal(thread.folder, fs.realpathSync(folder))
    assert.equal(seen[0].folder, fs.realpathSync(folder))
    assert.equal(seen[0].conversationId, thread.id)
    assert.ok(seen[0].signal, 'tools receive the run signal so a stop cancels them')
    assert.equal(thread.messages.at(-1).tools[0].output, 'record created')
    assert.equal(chat.list()[0].folder, fs.realpathSync(folder))

    // The folder sticks to the conversation and can be rebound.
    await chat.send(
      { conversationId: thread.id, runId: 'run-again', text: 'Create a task' },
      1,
      () => {},
    )
    assert.equal(seen[1].folder, fs.realpathSync(folder))
    assert.equal(chat.setFolder(thread.id, other).folder, fs.realpathSync(other))

    // A folder that moved away is dropped instead of failing the next reply.
    fs.rmSync(other, { recursive: true, force: true })
    const after = await chat.send(
      { conversationId: thread.id, runId: 'run-missing', text: 'Create a task' },
      1,
      () => {},
    )
    assert.equal(after.folder, null)
    assert.equal(seen[2].folder, null)
  } finally {
    await server.close()
    fs.rmSync(folder, { recursive: true, force: true })
    fs.rmSync(other, { recursive: true, force: true })
  }
})

test('disabled/read-only access excludes write tools; provider failures persist visibly', async () => {
  const server = await mockModel()
  try {
    for (const access of ['none', 'read']) {
      const { chat, planner, config } = fixture(server.baseURL, access)
      const result = await chat.send({ runId: `run-${access}`, text: 'Hello' }, 1, () => {})
      assert.equal(planner.list().length, 0)
      assert.equal(server.requests.at(-1).body.tools, undefined)
      assert.match(result.messages.at(-1).text, /Hello/)
      const { defaultSystemPrompt, hasApiKey, ...settings } = config.get()
      config.save({ ...settings, model: 'error-model' })
      const failed = await chat.send({ runId: `error-${access}`, text: 'Hello' }, 1, () => {})
      assert.equal(failed.messages.at(-1).status, 'error')
      assert.match(failed.messages.at(-1).error, /Invalid API key/)
    }
  } finally {
    await server.close()
  }
})

test('a request can only be cancelled by its owner and saves partial output', async () => {
  const server = await mockModel()
  try {
    const { chat } = fixture(server.baseURL, 'none')
    const result = await chat.send({ runId: 'slow', text: 'slow reply' }, 42, (event) => {
      if (event.type === 'text') {
        chat.cancel('slow', 7)
        assert.equal(chat.active.get('slow').controller.signal.aborted, false)
        chat.cancel('slow', 42)
      }
    })
    assert.equal(result.messages.at(-1).status, 'stopped')
    assert.match(result.messages.at(-1).text, /Starting/)
    assert.equal(chat.active.size, 0)
  } finally {
    await server.close()
  }
})

test('config never returns keys and changing hosts clears the old credential', () => {
  const { config } = fixture('https://example.com/v1')
  assert.equal(config.get().hasApiKey, true)
  assert.equal(JSON.stringify(config.get()).includes('test-key'), false)
  const { hasApiKey, defaultSystemPrompt, ...settings } = config.get()
  config.save({ ...settings, baseURL: 'https://another.example/v1' })
  assert.equal(config.resolve().apiKey, undefined)
  assert.throws(() => validateBaseURL('http://remote.example/v1'))
  assert.throws(() => validateBaseURL('https://user:key@example.com/v1'))
})

test('planner commands validate dates and merge without overwriting newer local changes', () => {
  const repo = new PlannerRepository(memory())
  assert.throws(() => repo.create({ kind: 'event', title: 'Invalid', date: '2026-02-30' }))
  const item = repo.create({ kind: 'todo', title: 'Original' })
  const stale = repo.document()
  repo.update({ id: item.id, title: 'Edited by chat' })
  repo.merge(stale)
  assert.equal(repo.list()[0].title, 'Edited by chat')
  repo.remove({ id: item.id })
  assert.equal(repo.list().length, 0)
  assert.equal(repo.document().records[0].deleted, true)
})
