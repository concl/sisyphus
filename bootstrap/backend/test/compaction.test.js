const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Compactor, estimate } = require('../../../plugins/chat/backend/lib/compaction')
const { modelContext } = require('../../../plugins/chat/backend/lib/chat-tree')

const old = [
  { role: 'user', content: 'Task: preserve exact file C:/work/notes.txt and finish the report. '.repeat(1000) },
  { role: 'assistant', content: [{ type: 'reasoning', text: 'old reasoning '.repeat(3000) }, { type: 'text', text: 'Report started.' }] },
]
test('compaction preserves system, latest user including attachments and whole recent tool exchanges', async () => {
  const system = { role: 'system', content: 'Exact system prompt  \n' }
  const user = { role: 'user', content: [{ type: 'text', text: ' Finish it exactly. \n' }, { type: 'image', image: 'aW1hZ2U=', mediaType: 'image/png' }] }
  const call = { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call', toolName: 'read_file', input: { path: 'notes.txt' } }] }
  const output = { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call', toolName: 'read_file', output: { type: 'text', value: 'report body' } }] }
  const messages = [system, ...old, user, call, output]
  const original = structuredClone(messages)
  const chunks = []
  const compactor = new Compactor({ settings: { enabled: true, contextTokens: 16000 }, summarize: async (memory, chunk) => { chunks.push(chunk); return 'Continue report in C:/work/notes.txt. Preserve user requirements.' } })
  const compact = await compactor.prepare(messages)
  assert(chunks.length > 0)
  assert(!chunks.join('').includes('old reasoning'))
  for (const message of [system, user, call, output]) assert(compact.includes(message))
  assert(estimate(compact) < estimate(messages))
  assert.deepEqual(messages, original)
  assert(compactor.changed)
})

test('below threshold or disabled keeps the entire input unchanged', async () => {
  const messages = [{ role: 'user', content: 'Hello' }]
  const summarize = () => { throw new Error('must not summarize') }
  assert.equal(await new Compactor({ summarize }).prepare(messages), messages)
  assert.equal(await new Compactor({ settings: { enabled: false }, summarize }).prepare(old), old)
})

test('failed summary never replaces original context, oversized latest message fails explicitly', async () => {
  const messages = [...old, { role: 'user', content: 'Continue' }]
  const compactor = new Compactor({ settings: { contextTokens: 8000 }, summarize: async () => '' })
  await assert.rejects(compactor.prepare(messages), /returned no summary/)
  assert.equal(compactor.changed, false)
  await assert.rejects(compactor.prepare([{ role: 'user', content: 'x'.repeat(40000) }]), /preserved/)
})

test('persisted context replaces only its ancestral branch; original history remains readable', () => {
  const memory = [{ role: 'assistant', content: 'Summary of branch A' }, { role: 'user', content: 'A' }, { role: 'assistant', content: 'Done A' }]
  const messages = [
    { id: 'u', role: 'user', text: 'Opening', parentId: null },
    { id: 'a', role: 'assistant', text: 'Long original reply', parentId: 'u' },
    { id: 'ua', role: 'user', text: 'A', parentId: 'a' },
    { id: 'aa', role: 'assistant', text: 'Done A', parentId: 'ua', compactedContext: memory },
    { id: 'ub', role: 'user', text: 'B', parentId: 'a' },
  ]
  assert.deepEqual(modelContext(messages, 'aa'), memory)
  assert.deepEqual(modelContext(messages, 'aa', message => message.text, false).map(message => message.content), ['Opening', 'Long original reply', 'A', 'Done A'])
  assert.deepEqual(modelContext(messages, 'ub').map(message => message.content), ['Opening', 'Long original reply', 'B'])
  assert.equal(messages[1].text, 'Long original reply')
})
