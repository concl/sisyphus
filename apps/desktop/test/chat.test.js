const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  ChatConfig,
  DEFAULT_LIMITS,
  DEFAULT_PROMPT,
  readLimits,
  validateBaseURL,
} = require('../../../plugins/chat/native/lib/chat-config.js')
const { ChatService } = require('../../../plugins/chat/native/lib/chat-service.js')
const { ChatHistory } = require('../../../plugins/chat/native/lib/chat-history.js')
const { activePath, siblings } = require('../../../plugins/chat/native/lib/chat-tree.js')
const { PlannerRepository, createSchema } = require('../../../plugins/planner/native/lib/planner-data.js')
const mockModel = require('../smoke/mock-model')

function memory() {
  const data = new Map()
  return {
    get: (scope, key) => structuredClone(data.get(`${scope}:${key}`)),
    set: (scope, key, value) => data.set(`${scope}:${key}`, structuredClone(value)),
  }
}
function fixture(baseURL, access = 'write', toolOverride = null, timeouts) {
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
  // A real history directory, so the tests use the same one-file-per-chat store
  // the app does.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-history-'))
  const history = new ChatHistory(directory)
  return {
    storage,
    config,
    planner,
    history,
    directory,
    chat: new ChatService({ history, config, registry, timeouts }),
  }
}

/** Saves limits the way the settings form does, keeping every other field. */
function withLimits(config, limits) {
  const { hasApiKey, defaultSystemPrompt, defaultLimits, ...settings } = config.get()
  config.save({ ...settings, limits: { ...settings.limits, ...limits } })
}

test('next request replays all tool steps and reasoning with an unchanged system prefix', async () => {
  const server = await mockModel()
  const { chat, history } = fixture(server.baseURL)
  try {
    const first = await chat.send({ runId: 'cache-1', text: 'Create a task' }, 1, () => {})
    const providerMessages = history.get(first.id).messages.at(-1).model
    assert(providerMessages.some(message => message.role === 'tool'), 'tool result must be stored, not just the final step')
    const count = server.requests.length
    await chat.send({ runId: 'cache-2', conversationId: first.id, text: 'Continue' }, 1, () => {})
    const next = server.requests[count].body.messages
    assert(next.some(message => message.role === 'tool'), 'tool result must reach the next request')
    assert(next.some(message => message.tool_calls?.length), 'tool call IDs must survive')
    assert.deepEqual(next[0], server.requests[0].body.messages[0], 'system prefix must stay stable')
    const thinking = await chat.send({ runId: 'think-1', text: 'think about a number' }, 1, () => {})
    const before = server.requests.length
    await chat.send({ runId: 'think-2', conversationId: thinking.id, text: 'Continue' }, 1, () => {})
    assert(server.requests[before].body.messages.some(message => message.reasoning_content?.includes('42')))
    assert(thinking.messages.at(-1).context.tokens > 0)
  } finally { await chat.dispose(); await server.close() }
})

test('worker permits concurrent conversations from one window, scopes cancellation, and rejects same-thread overlap', async () => {
  const { createWorker } = require('../lib/plugin-compiler')
  const { WorkerChat } = require('../../../plugins/chat/native/worker-client')
  const server = await mockModel()
  const { config, directory } = fixture(server.baseURL)
  const chat = new WorkerChat({ workers: { create: createWorker }, directory, config, registry: { list: () => [] } })
  let started
  const ready = new Promise(resolve => { started = resolve })
  try {
    const first = chat.send({ runId: 'worker-slow', text: 'slow' }, 1, event => {
      if (event.type === 'start') started(event.conversation.id)
    })
    const threadId = await ready
    await assert.rejects(chat.send({ runId: 'overlap', conversationId: threadId, text: 'again' }, 1, () => {}), /already running/)
    const second = await chat.send({ runId: 'worker-fast', text: 'think' }, 1, () => {})
    assert.equal(second.messages.at(-1).text, 'It is 42.')
    assert.equal((await chat.get(threadId)).messages.length, 1)
    await chat.cancel('worker-slow', 1)
    assert.equal((await first).messages.at(-1).status, 'stopped')
  } finally { await chat.dispose(); await server.close() }
})

test('a task can be scheduled, completed, and unscheduled without changing identity', () => {
  const planner = new PlannerRepository(memory())
  const task = planner.create({ title: 'One shared item' })
  assert.equal(task.date, undefined)
  planner.update({ id: task.id, date: '2026-09-18' })
  planner.update({ id: task.id, done: true })
  assert.equal(planner.list().filter(item => item.date).length, 1)
  planner.update({ id: task.id, date: null })
  assert.equal(planner.list().filter(item => item.date).length, 0)
  assert.equal(planner.list()[0].id, task.id)
  assert.equal(planner.list()[0].done, true)
})

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
    // The reply records what happened in order: the tool call, then the text the
    // model wrote after reading the result.
    const assistant = result.messages.at(-1)
    assert.deepEqual(
      assistant.parts.map((part) => (part.type === 'text' ? 'text' : part.toolId)),
      [assistant.tools[0].id, 'text'],
    )
    assert.equal(assistant.parts.at(-1).text, assistant.text)
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
      const { defaultSystemPrompt, hasApiKey, defaultLimits, ...settings } = config.get()
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

test('reasoning streams into the transcript without becoming the answer', async () => {
  const server = await mockModel()
  try {
    const { chat } = fixture(server.baseURL, 'none')
    const events = []
    const result = await chat.send({ runId: 'think', text: 'think about 42' }, 1, (event) =>
      events.push(event),
    )
    const reply = result.messages.at(-1)
    assert.equal(reply.status, 'complete')
    assert.equal(reply.text, 'It is 42.')
    assert.equal(reply.reasoning, 'The user wants a number. I know this one: 42.')
    // The reply keeps the order it streamed in: thinking, then the answer.
    assert.deepEqual(
      reply.parts.map((part) => part.type),
      ['reasoning', 'text'],
    )
    assert.equal(reply.parts[0].text, reply.reasoning)
    assert.equal(reply.parts.at(-1).text, reply.text)
    assert.ok(
      events.some((event) => event.type === 'reasoning' && event.text.includes('number')),
      'reasoning should stream to the panel as it arrives',
    )
    assert.equal(chat.get(result.id).messages.at(-1).reasoning, reply.reasoning)
  } finally {
    await server.close()
  }
})

test('a reply that only calls tools ends with the step budget explained', async () => {
  const server = await mockModel()
  try {
    const { chat, config } = fixture(server.baseURL, 'write')
    // No step budget is the shipped default, so a test that wants one asks for
    // it the way the settings form does.
    withLimits(config, { maxSteps: 4 })
    const result = await chat.send({ runId: 'loop', text: 'loop forever' }, 1, () => {})
    const reply = result.messages.at(-1)
    assert.equal(reply.status, 'complete')
    assert.match(reply.notice, /limit of 4 tool steps/)
    assert.equal(reply.tools.length, 4)
    // The app's explanation is a notice, never the model's answer: a reader must
    // not be able to mistake it for something the model wrote.
    assert.equal(reply.text, '')
    assert.equal(reply.parts.at(-1).type, 'notice')
    assert.equal(reply.parts.at(-1).text, reply.notice)
  } finally {
    await server.close()
  }
})

test('the default limits let a reply work until the task is done', async () => {
  const server = await mockModel()
  try {
    const { chat, config } = fixture(server.baseURL, 'write')
    // Nothing is capped out of the box: no step budget, no silence deadline, no
    // tool deadline. A limit is something the user opts into.
    assert.deepEqual(config.get().limits, DEFAULT_LIMITS)
    assert.deepEqual(config.get().defaultLimits, DEFAULT_LIMITS)
    assert.equal(config.get().limits.maxSteps, 0)
    const result = await chat.send({ runId: 'long-job', text: 'run a long job' }, 1, () => {})
    const reply = result.messages.at(-1)
    assert.equal(reply.status, 'complete', JSON.stringify(reply.error))
    assert.match(reply.text, /Done after 30 steps/)
    assert.equal(reply.tools.length, 30)
    assert.ok(
      reply.tools.length > 24,
      'a fixed budget of 24 steps would have cut this reply off mid-work',
    )
  } finally {
    await server.close()
  }
})

// The bug this guards: the SDK's per-chunk timer keeps running while a tool
// executes (tools run inside its stream pipeline), so a tool that took longer
// than the window was reported as the model going quiet, and the whole reply was
// thrown away mid-work with the model blamed for it.
test('a tool that takes its time is not mistaken for a silent model', async () => {
  const server = await mockModel()
  try {
    const { chat } = fixture(
      server.baseURL,
      'write',
      {
        name: 'create_planner_item',
        description: 'Create a task',
        access: 'write',
        inputSchema: createSchema,
        // Comfortably longer than the injected silence window.
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 900))
          return 'patient result'
        },
      },
      { firstChunkMs: 5000, chunkMs: 300 },
    )
    const result = await chat.send({ runId: 'patient', text: 'patient work' }, 1, () => {})
    const reply = result.messages.at(-1)
    assert.equal(reply.status, 'complete', reply.error)
    assert.match(reply.text, /Finished the long tool call/)
    assert.equal(reply.tools[0].status, 'complete')
    assert.equal(reply.tools[0].output, 'patient result')
  } finally {
    await server.close()
  }
})

test('a tool that overruns its own budget fails on its own, and the reply carries on', async () => {
  const server = await mockModel()
  try {
    const { chat } = fixture(
      server.baseURL,
      'write',
      {
        name: 'create_planner_item',
        description: 'Create a task',
        access: 'write',
        inputSchema: createSchema,
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 900))
          return 'too late'
        },
      },
      { firstChunkMs: 5000, chunkMs: 5000, toolMs: 200 },
    )
    const result = await chat.send({ runId: 'tool-budget', text: 'patient work' }, 1, () => {})
    const reply = result.messages.at(-1)
    // The tool is what failed, and the model is told so: the reply is not lost,
    // it continues with the failure in hand.
    assert.equal(reply.status, 'complete', reply.error)
    assert.match(reply.text, /Finished the long tool call/)
    assert.equal(reply.tools[0].status, 'failed')
    assert.match(reply.tools[0].output, /still running after 200ms/)
  } finally {
    await server.close()
  }
})

test('a server that never says anything is reported as never having started', async () => {
  const server = await mockModel()
  try {
    const { chat } = fixture(server.baseURL, 'none', null, { firstChunkMs: 150, chunkMs: 5000 })
    const result = await chat.send({ runId: 'silent', text: 'silent please' }, 1, () => {})
    const reply = result.messages.at(-1)
    assert.equal(reply.status, 'error')
    assert.match(reply.error, /did not start replying/)
    assert.equal(reply.text, '')
  } finally {
    await server.close()
  }
})

test('a reply cut off by the output budget says so instead of looking empty', async () => {
  const server = await mockModel()
  try {
    const { chat } = fixture(server.baseURL, 'none')
    const result = await chat.send({ runId: 'budget', text: 'truncate this' }, 1, () => {})
    const reply = result.messages.at(-1)
    assert.equal(reply.status, 'complete')
    assert.match(reply.notice, /ran out of its output budget/)
    assert.equal(reply.text, '')
    assert.equal(reply.reasoning, 'Still thinking…')
  } finally {
    await server.close()
  }
})

test('a stalled stream is reported as such and keeps the partial reply', async () => {
  const server = await mockModel()
  try {
    // A reply that may run for many steps is not cut off by a wall-clock
    // deadline; only silence ends it.
    const { chat } = fixture(server.baseURL, 'none', null, { firstChunkMs: 200, chunkMs: 200 })
    const result = await chat.send({ runId: 'stall', text: 'stall please' }, 1, () => {})
    const reply = result.messages.at(-1)
    assert.equal(reply.status, 'error')
    assert.match(reply.error, /stopped sending data/)
    assert.equal(reply.text, 'Starting…')
    assert.equal(chat.active.size, 0)
  } finally {
    await server.close()
  }
})

test('limits can be set, kept, and cleared back to work-forever', () => {
  const { config } = fixture('https://example.com/v1')
  assert.deepEqual(config.get().limits, DEFAULT_LIMITS)
  // A hand-edited or older file cannot leave a field unusable, one field at a
  // time, and 0 is a choice rather than a missing value.
  assert.deepEqual(readLimits({ maxSteps: -5, chunkSeconds: 'nope' }), DEFAULT_LIMITS)
  assert.equal(readLimits({ maxSteps: 0 }).maxSteps, 0)
  withLimits(config, { maxSteps: 5 })
  assert.equal(config.get().limits.maxSteps, 5)
  // A caller that does not mention limits (an older form, a partial update)
  // keeps what is stored instead of resetting it.
  const { hasApiKey, defaultSystemPrompt, defaultLimits, limits, ...settings } = config.get()
  config.save(settings)
  assert.equal(config.get().limits.maxSteps, 5)
  config.save({ ...settings, limits: config.get().defaultLimits })
  assert.deepEqual(config.get().limits, DEFAULT_LIMITS)
})

test('config never returns keys and changing hosts clears the old credential', () => {
  const { config } = fixture('https://example.com/v1')
  assert.equal(config.get().hasApiKey, true)
  assert.equal(JSON.stringify(config.get()).includes('test-key'), false)
  const { hasApiKey, defaultSystemPrompt, defaultLimits, ...settings } = config.get()
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

test('the step budget is a setting, and an edit branches instead of replacing history', async () => {
  const server = await mockModel()
  try {
    const { chat, config, directory } = fixture(server.baseURL, 'write')
    const first = await chat.send({ runId: 'b-1', text: 'Create a task' }, 1, () => {})
    const original = first.messages[0]
    // One file per conversation, named after its id.
    assert.deepEqual(
      fs.readdirSync(directory),
      [`${first.id}.json`],
      'a conversation is one file, not a row in a shared list',
    )

    const edited = await chat.edit(
      {
        conversationId: first.id,
        editMessageId: original.id,
        runId: 'b-2',
        text: 'Create a task',
      },
      1,
      () => {},
    )
    // The new attempt answers the same parent, so it is a sibling of the original
    // rather than a second message after it.
    assert.equal(edited.messages.length, 4)
    assert.equal(edited.messages[2].parentId, null)
    assert.equal(edited.messages[3].parentId, edited.messages[2].id)
    assert.equal(edited.messages[1].parentId, original.id)
    assert.deepEqual(
      siblings(edited.messages, original).map((message) => message.id),
      [original.id, edited.messages[2].id],
    )
    // Only the selected branch is on screen: two messages, not four.
    assert.deepEqual(
      activePath(edited).map((message) => message.id),
      [edited.messages[2].id, edited.messages[3].id],
    )

    // Switching branches lands on that branchs finished turn.
    const switched = chat.selectBranch({ conversationId: first.id, messageId: original.id })
    assert.equal(switched.activeLeafId, edited.messages[1].id)
    assert.deepEqual(
      activePath(switched).map((message) => message.id),
      [original.id, edited.messages[1].id],
    )
    // Only your own messages can be edited.
    await assert.rejects(
      chat.edit(
        {
          conversationId: first.id,
          editMessageId: edited.messages[1].id,
          runId: 'b-3',
          text: 'x',
        },
        1,
        () => {},
      ),
      /Only your own messages/,
    )

    // The step budget comes from settings instead of being a constant.
    const { hasApiKey, defaultSystemPrompt, defaultLimits, ...settings } = config.get()
    config.save({ ...settings, limits: { ...settings.limits, maxSteps: 3 } })
    assert.equal(config.get().limits.maxSteps, 3)
    const looped = await chat.send({ runId: 'b-4', text: 'loop forever' }, 9, () => {})
    const reply = looped.messages.at(-1)
    assert.match(reply.notice, /limit of 3 tool steps/)
    assert.ok(reply.tools.length <= 3, `expected 3 tool steps, got ${reply.tools.length}`)
  } finally {
    await server.close()
  }
})

test('the old single-file history imports once, one file per conversation', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-history-'))
  const history = new ChatHistory(directory)
  const legacy = [
    {
      id: 'old-thread',
      title: 'Older conversation',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: [
        { id: 'm1', role: 'user', text: 'hi' },
        { id: 'm2', role: 'assistant', text: 'hello' },
      ],
    },
  ]
  const report = history.import(legacy)
  assert.deepEqual(report.imported, ['old-thread'])
  assert.deepEqual(fs.readdirSync(directory), ['old-thread.json'])
  // A flat conversation becomes a linear chain without changing its meaning.
  const thread = history.get('old-thread')
  assert.equal(thread.messages[1].parentId, 'm1')
  assert.equal(thread.activeLeafId, 'm2')
  assert.equal(thread.messages[0].text, 'hi')
  // The second run keeps the file that exists instead of overwriting it.
  assert.deepEqual(history.import(legacy).skipped, ['old-thread'])
  // A conversation id is a file name, so nothing can escape the directory.
  assert.throws(() => history.file('../escape'))
})
