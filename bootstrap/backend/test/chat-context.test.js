const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { z } = require('zod')
const { ChatService } = require('../../../plugins/chat/backend/lib/chat-service')
const { ChatHistory } = require('../../../plugins/chat/backend/lib/chat-history')
const { createWorker } = require('../lib/plugin-compiler')
const { WorkerChat } = require('../../../plugins/chat/backend/worker-client')

async function serverFixture() {
  const requests = []
  let step = 0
  const server = http.createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw)
    requests.push(body)
    if (!body.stream) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ id: 'summary', object: 'chat.completion', created: 1, model: 'test', choices: [{ index: 0, message: { role: 'assistant', content: 'Memory: preserve C:/work/report.txt; prior tools completed; continue the requested task.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }))
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const send = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({ id: 'turn', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
    step++
    if (step <= 10) {
      send({ role: 'assistant', tool_calls: [{ index: 0, id: `call-${step}`, type: 'function', function: { name: 'observe', arguments: JSON.stringify({ step }) } }] })
      send({}, 'tool_calls')
    } else { send({ role: 'assistant', content: 'Finished.' }); send({}, 'stop') }
    response.end('data: [DONE]\n\n')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { requests, baseURL: `http://127.0.0.1:${server.address().port}/v1`, close: () => new Promise(resolve => server.close(resolve)) }
}

for (const worker of [false, true]) test(`image tools and mid-run compaction survive ${worker ? 'worker RPC' : 'direct harness'}, history replay and branch edits`, async () => {
  const server = await serverFixture()
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-context-'))
  const settings = { baseURL: server.baseURL, model: 'test', systemPrompt: 'Exact system prefix. Preserve requirements.', access: 'write', compaction: { enabled: true, contextTokens: 24000 } }
  const ended = []
  const registry = { list: () => [{ name: 'observe', description: 'Inspect current state', access: 'write', inputSchema: z.object({ step: z.number() }),
    execute: ({ step }, context) => {
      assert.equal(context.runId, 'long-context')
      return step === 10 ? { type: 'computer-screenshot', data: 'iVBORw0KGgo=', mediaType: 'image/png', screenshotId: 'image-10', width: 1600, height: 900 }
        : { text: `Result ${step}: ` + 'log line '.repeat(1800), path: 'C:/work/report.txt' }
    }, endRun: context => ended.push(context.runId) }] }
  const config = { resolve: () => settings, get: () => settings }
  const chat = worker ? new WorkerChat({ workers: { create: createWorker }, directory, registry, config })
    : new ChatService({ history: new ChatHistory(directory), config, registry })
  try {
    const exact = '  Complete the long task. Preserve my spacing. \n'
    const result = await chat.send({ runId: 'long-context', text: exact }, 1, () => {})
    assert.equal(result.messages.at(-1).status, 'complete', result.messages.at(-1).error)
    assert.equal(result.messages.at(-1).text, 'Finished.')
    assert(result.messages.at(-1).parts.some(part => part.type === 'notice' && part.text.includes('Context compacted')))
    const summaries = server.requests.filter(request => !request.stream)
    assert(summaries.length > 0)
    assert(summaries.every(request => !request.tools?.length))
    const calls = server.requests.filter(request => request.stream)
    for (const request of calls) {
      assert.deepEqual(request.messages[0], calls[0].messages[0])
      assert(request.messages.some(message => message.role === 'user' && message.content === exact))
    }
    const finalRequest = calls.at(-1)
    assert(finalRequest.messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image_url')))
    assert(!finalRequest.messages.filter(message => message.role === 'tool').some(message => message.content.includes('iVBOR')))
    const persisted = new ChatHistory(directory).get(result.id)
    assert(persisted.messages.at(-1).compactedContext.length)
    assert(persisted.messages.at(-1).model.length > persisted.messages.at(-1).compactedContext.length)
    assert(!result.messages.at(-1).compactedContext, 'private memory does not leak into renderer payloads')
    const count = server.requests.length
    await chat.send({ runId: 'followup', conversationId: result.id, text: 'Continue' }, 1, () => {})
    assert(server.requests[count].messages.some(message => String(message.content).includes('Memory: preserve')))
    const branchCount = server.requests.length
    await chat.edit({ runId: 'branch', conversationId: result.id, editMessageId: result.messages[0].id, text: 'New branch' }, 1, () => {})
    assert(!server.requests[branchCount].messages.some(message => String(message.content).includes('Memory: preserve')))
    assert(ended.includes('long-context'))
  } finally { await chat.dispose(); await server.close(); fs.rmSync(directory, { recursive: true, force: true }) }
})
