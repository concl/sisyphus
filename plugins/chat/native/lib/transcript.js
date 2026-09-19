'use strict'
// Order of assistant text and tool calls inside one reply. The renderer mirrors
// these helpers in plugins/chat/src/transcript.ts for the live reply, so
// the recorded order and the streamed order agree.

// Text streams in as deltas; consecutive deltas are one text part.
function appendText(parts, text) {
  if (!text) return parts
  const last = parts.at(-1)
  return last?.type === 'text'
    ? [...parts.slice(0, -1), { type: 'text', text: last.text + text }]
    : [...parts, { type: 'text', text }]
}

// Reasoning streams like text but stays its own part, so the transcript can
// show what the model was thinking before an answer or a tool call.
function appendReasoning(parts, text) {
  if (!text) return parts
  const last = parts.at(-1)
  return last?.type === 'reasoning'
    ? [...parts.slice(0, -1), { type: 'reasoning', text: last.text + text }]
    : [...parts, { type: 'reasoning', text }]
}

// A tool call splits the reply: text after it becomes a new part.
function addTool(parts, toolId) {
  return parts.some((part) => part.type === 'tool' && part.toolId === toolId)
    ? parts
    : [...parts, { type: 'tool', toolId }]
}

module.exports = { appendText, appendReasoning, addTool }
