const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { z } = require('zod')
const { ChatConfig } = require('../../../plugins/chat/backend/lib/chat-config.js')
const { ChatHistory } = require('../../../plugins/chat/backend/lib/chat-history.js')
const { ChatService } = require('../../../plugins/chat/backend/lib/chat-service.js')
const { HarnessRegistry, createHarnessRegistry } = require('../../../plugins/chat/backend/harness/registry.js')
const { DEFAULT_HARNESS } = require('../../../plugins/chat/backend/harness/contract.js')

function memory() {
  const data = new Map()
  return {
    get: (scope, key) => structuredClone(data.get(`${scope}:${key}`)),
    set: (scope, key, value) => data.set(`${scope}:${key}`, structuredClone(value)),
  }
}

function fixture({ harness = 'fake', harnesses } = {}) {
  const storage = memory()
  const config = new ChatConfig(storage, {
    has: () => true,
    read: () => 'test-key',
    write: () => {},
    clear: () => {},
  })
  config.save({
    baseURL: 'https://example.com/v1',
    model: 'test-model',
    systemPrompt: 'A fixed system prompt.',
    access: 'write',
    apiKey: 'test-key',
    harness,
    compaction: { enabled: true, contextTokens: 32000 },
  })
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-harness-'))
  const attachments = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-harness-files-'))
  const calls = []
  const fake = {
    id: 'fake',
    name: 'Fake harness',
    description: 'Used by the harness contract tests.',
    async run(request, control) {
      calls.push(request)
      control.emit({ type: 'reasoning', text: 'Thinking. ' })
      const echo = request.tools.find((tool) => tool.name === 'echo')
      const output = await echo.execute({ value: 'one' })
      control.emit({ type: 'text', text: `Echo said ${output}.` })
      control.emit({
        type: 'context',
        context: { tokens: 12, inputTokens: 10, outputTokens: 2, estimated: false },
      })
      return { transcript: [{ role: 'assistant', content: 'fake transcript' }], finishReason: 'stop' }
    },
  }
  const registry = new HarnessRegistry(harnesses ?? [fake])
  const chat = new ChatService({
    history: new ChatHistory(directory),
    config,
    registry: {
      list: () => [
        {
          name: 'echo',
          description: 'Return the input.',
          access: 'write',
          inputSchema: z.object({ value: z.string() }).strict(),
          execute: (input) => input.value,
        },
      ],
    },
    attachments,
    harnesses: registry,
  })
  return { chat, config, calls, directory, attachments }
}

test('a harness is selected by id, gets JSON Schema tools, and streams through Chat', async () => {
  const { chat, calls } = fixture()
  const events = []
  try {
    const thread = await chat.send({ runId: 'fake-1', text: 'hello' }, 1, (event) => events.push(event))
    const reply = thread.messages.at(-1)
    assert.equal(reply.status, 'complete')
    assert.equal(reply.text, 'Echo said one.')
    assert.equal(reply.reasoning, 'Thinking. ')
    assert.deepEqual(reply.parts.map((part) => part.type), ['reasoning', 'tool', 'text'])
    assert.equal(reply.tools[0].status, 'complete')
    assert.equal(reply.tools[0].output, 'one')
    assert.deepEqual(reply.context, {
      tokens: 12,
      inputTokens: 10,
      outputTokens: 2,
      estimated: false,
    })
    assert.ok(events.some((event) => event.type === 'reasoning'))
    assert.ok(events.some((event) => event.type === 'tool' && event.tool.status === 'complete'))
    assert.ok(events.some((event) => event.type === 'text'))

    // The contract is what a new adapter implements; no AI SDK objects leak in.
    const request = calls[0]
    assert.equal(request.provider.model, 'test-model')
    assert.equal(request.access, 'write')
    assert.equal(request.folder, null)
    assert.deepEqual(request.limits, { maxSteps: 0, maxRetries: 1 })
    assert.deepEqual(request.tools[0].parameters, {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    })
    assert.equal(request.messages.length, 1)
    assert.equal(request.messages[0].role, 'user')
    assert.equal(request.messages[0].text, 'hello')

    // The reply records which harness produced it and keeps that harness's
    // opaque transcript for exact replay.
    const stored = chat.history.get(thread.id).messages.at(-1)
    assert.equal(stored.harness, 'fake')
    assert.deepEqual(stored.model, [{ role: 'assistant', content: 'fake transcript' }])
    assert.equal('harness' in chat.get(thread.id).messages.at(-1), false)
  } finally {
    await chat.dispose()
  }
})

test('a second turn receives normalized history, including tool calls and results', async () => {
  const { chat, calls } = fixture()
  try {
    const first = await chat.send({ runId: 'fake-2', text: 'hello' }, 1, () => {})
    await chat.send(
      { runId: 'fake-3', conversationId: first.id, text: 'again' },
      1,
      () => {},
    )
    const history = calls[1].messages
    assert.deepEqual(history.map((message) => message.role), ['user', 'assistant', 'user'])
    assert.equal(history[1].text, 'Echo said one.')
    assert.equal(history[1].toolCalls[0].name, 'echo')
    assert.deepEqual(history[1].toolCalls[0].input, { value: 'one' })
    assert.equal(history[1].toolCalls[0].output, 'one')
    assert.equal(history[1].toolCalls[0].status, 'complete')
    assert.equal(history[2].text, 'again')
  } finally {
    await chat.dispose()
  }
})

test('an unknown harness fails with a message that names the setting', async () => {
  const { chat } = fixture({ harness: 'not-installed' })
  try {
    await assert.rejects(
      chat.send({ runId: 'missing-1', text: 'hello' }, 1, () => {}),
      /agent harness "not-installed" is not available/,
    )
  } finally {
    await chat.dispose()
  }
})

test('the silence watchdog stops a harness that never streams', async () => {
  const { chat, calls } = fixture()
  // Replace the fake with one that ignores its abort signal. The watchdog must
  // still end the reply and save it instead of waiting forever.
  chat.harnesses = new HarnessRegistry([
    {
      id: 'stuck',
      name: 'Stuck harness',
      async run(request) {
        calls.push(request)
        return new Promise(() => {})
      },
    },
  ])
  const config = chat.config.get()
  const { harnesses, ...settings } = config
  chat.config.save({ ...settings, harness: 'stuck' })
  chat.timeouts = { firstChunkMs: 30 }
  try {
    const thread = await chat.send({ runId: 'stuck-1', text: 'hello' }, 1, () => {})
    const reply = thread.messages.at(-1)
    assert.equal(reply.status, 'error')
    assert.match(reply.error, /did not start replying/)
    assert.equal(chat.active.size, 0)
  } finally {
    await chat.dispose()
  }
})

test('the default registry ships the AI SDK harness and exposes only metadata', () => {
  const registry = createHarnessRegistry()
  assert.ok(registry.get(DEFAULT_HARNESS))
  const listed = registry.list()
  assert.equal(listed.length, 1)
  assert.equal(listed[0].id, DEFAULT_HARNESS)
  assert.equal('run' in listed[0], false)
  assert.throws(
    () => new HarnessRegistry([{ id: 'Bad Id', name: 'x', run() {} }]),
    /lowercase id/,
  )
  assert.throws(
    () =>
      new HarnessRegistry([
        { id: 'same', name: 'One', run() {} },
        { id: 'same', name: 'Two', run() {} },
      ]),
    /Duplicate agent harness/,
  )
})
