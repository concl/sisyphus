'use strict'
// A conversation is a tree of messages, not a list. Every message names the
// message it answers (`parentId`, null at the start of the conversation), so
// editing a message adds a sibling branch next to the original instead of
// rewriting history, and `activeLeafId` says which branch is on screen. The
// renderer mirrors these helpers in plugins/chat/src/tree.ts.

// Conversations written before branching existed are a flat list: give them a
// linear chain so nothing that is already stored changes meaning when it is
// read. An array that mixes both shapes is repaired the same way.
function normalizeMessages(messages = []) {
  const linked = messages.some((message) => message.parentId !== undefined)
  if (!linked)
    return messages.map((message, index) => ({
      ...message,
      parentId: index === 0 ? null : messages[index - 1].id,
    }))
  return messages.map((message, index) =>
    message.parentId === undefined
      ? { ...message, parentId: index === 0 ? null : messages[index - 1].id }
      : message,
  )
}

// The whole shape of a stored conversation, ready to read: a tree with a branch
// selected. A thread from the old single-list store keeps every message.
function normalizeThread(thread) {
  const messages = normalizeMessages(thread.messages)
  return {
    ...thread,
    messages,
    activeLeafId: thread.activeLeafId ?? messages.at(-1)?.id ?? null,
  }
}

// The chain of messages that leads to `id`, oldest first.
function pathTo(messages, id) {
  const byId = new Map(messages.map((message) => [message.id, message]))
  const path = []
  const seen = new Set()
  for (
    let message = byId.get(id);
    message && !seen.has(message.id);
    message = byId.get(message.parentId)
  ) {
    seen.add(message.id)
    path.unshift(message)
  }
  return path
}

// The branch on screen. A selected leaf that no longer exists (a deleted
// message, an older file) falls back to the newest message.
function activePath(thread) {
  const messages = normalizeMessages(thread.messages)
  if (!messages.length) return []
  const leaf = messages.find((message) => message.id === thread.activeLeafId) ?? messages.at(-1)
  return pathTo(messages, leaf.id)
}

// Direct answers to a message, oldest first.
function children(messages, id) {
  return messages.filter((message) => (message.parentId ?? null) === id)
}

// The messages a message can be switched between: same parent, same role. Two
// user messages under one parent are the two attempts at that turn; their
// replies hang under each of them in turn.
function siblings(messages, message) {
  return messages.filter(
    (entry) =>
      (entry.parentId ?? null) === (message.parentId ?? null) && entry.role === message.role,
  )
}

function branchOf(messages, message) {
  const list = siblings(messages, message)
  return {
    ids: list.map((entry) => entry.id),
    index: list.findIndex((entry) => entry.id === message.id),
    count: list.length,
  }
}

// Where a branch ends: follow the newest child until there are no more, so
// switching branches lands on the finished turn rather than its first message.
function leafOf(messages, id) {
  let current = messages.find((message) => message.id === id)
  const seen = new Set()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    const next = children(messages, current.id).at(-1)
    if (!next) break
    current = next
  }
  return current?.id ?? id
}

function toolActivity(tools = []) {
  return `Tool activity: ${tools.map((entry) => `${entry.name}: ${entry.status}`).join(', ')}`
}

// What the model is shown for the branch that is on screen: each stored answer
// replays the provider messages it produced (so tool calls survive a reload),
// and anything without them falls back to plain text.
function modelContext(messages, id) {
  const context = []
  for (const message of pathTo(normalizeMessages(messages), id)) {
    if (message.role === 'user') context.push({ role: 'user', content: message.text })
    else if (message.model?.length) context.push(...message.model)
    else {
      const content = message.text || (message.tools?.length ? toolActivity(message.tools) : '')
      if (content) context.push({ role: 'assistant', content })
    }
  }
  return context
}

function summarize(thread) {
  return {
    id: thread.id,
    title: thread.title,
    updatedAt: thread.updatedAt,
    folder: thread.folder ?? null,
  }
}

module.exports = {
  normalizeMessages,
  normalizeThread,
  pathTo,
  activePath,
  children,
  siblings,
  branchOf,
  leafOf,
  modelContext,
  summarize,
}
