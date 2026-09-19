const { test } = require('node:test')
const assert = require('node:assert/strict')
const { appendText, appendReasoning, addTool } = require('../../../plugins/chat/native/lib/transcript.js')

test('text deltas coalesce into one part until a tool interrupts', () => {
  let parts = []
  parts = appendText(parts, 'Checking ')
  parts = appendText(parts, 'the file.')
  assert.deepEqual(parts, [{ type: 'text', text: 'Checking the file.' }])

  parts = addTool(parts, 'tool-1')
  parts = appendText(parts, 'Found it.')
  assert.deepEqual(parts, [
    { type: 'text', text: 'Checking the file.' },
    { type: 'tool', toolId: 'tool-1' },
    { type: 'text', text: 'Found it.' },
  ])
})

test('reasoning coalesces on its own and stays before the answer', () => {
  let parts = []
  parts = appendReasoning(parts, 'Which ')
  parts = appendReasoning(parts, 'file?')
  assert.deepEqual(parts, [{ type: 'reasoning', text: 'Which file?' }])

  // An answer after the thinking starts a new part instead of extending it.
  parts = appendText(parts, 'This one.')
  assert.deepEqual(parts, [
    { type: 'reasoning', text: 'Which file?' },
    { type: 'text', text: 'This one.' },
  ])

  // Thinking again after a step becomes its own part, in stream order.
  parts = addTool(parts, 'tool-1')
  parts = appendReasoning(parts, 'Done.')
  assert.deepEqual(
    parts.map((part) => (part.type === 'tool' ? part.toolId : `${part.type}:${part.text}`)),
    ['reasoning:Which file?', 'text:This one.', 'tool-1', 'reasoning:Done.'],
  )
  assert.deepEqual(appendReasoning([], ''), [])
})

test('empty deltas and repeated tool calls do not add parts', () => {
  let parts = addTool([], 'tool-1')
  parts = appendText(parts, '')
  parts = addTool(parts, 'tool-1')
  assert.deepEqual(parts, [{ type: 'tool', toolId: 'tool-1' }])
  assert.deepEqual(appendText([], ''), [])
})

test('a reply can interleave several tools with text', () => {
  let parts = []
  for (const [tool, text] of [
    ['read_file', 'Reading… '],
    ['edit_file', 'Editing… '],
  ]) {
    parts = appendText(parts, text)
    parts = addTool(parts, tool)
  }
  parts = appendText(parts, 'Done.')
  assert.deepEqual(
    parts.map((part) => (part.type === 'text' ? part.text.trim() : part.toolId)),
    ['Reading…', 'read_file', 'Editing…', 'edit_file', 'Done.'],
  )
})
