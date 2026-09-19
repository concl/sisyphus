import type { ChatMessage, ChatThread } from '@sisyphus/sdk'

/**
 * The conversation shape for the renderer: the same rules as the desktop side
 * (`apps/desktop/lib/chat-tree.js`), applied to whatever `chat.get` returned. A
 * conversation is a tree - every message names the message it answers - and
 * `activeLeafId` says which branch is on screen. Reading, not writing: the
 * service owns the stored tree.
 */

/** A conversation written before branching existed is a flat list. */
function linked(messages: ChatMessage[]): boolean {
  return messages.some((message) => message.parentId !== undefined)
}

/** Gives a flat conversation a linear chain, the way the stored copy does. */
export function normalizeMessages(messages: ChatMessage[] = []): ChatMessage[] {
  if (!linked(messages))
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

/** The chain of messages that leads to `id`, oldest first. */
export function pathTo(messages: ChatMessage[], id: string | null): ChatMessage[] {
  const byId = new Map(normalizeMessages(messages).map((message) => [message.id, message]))
  const path: ChatMessage[] = []
  const seen = new Set<string>()
  let current = id ? byId.get(id) : undefined
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return path
}

/**
 * The branch on screen. Only this branch is rendered, which is what makes an
 * edited turn a branch instead of a duplicated conversation.
 */
export function activePath(thread: ChatThread | null): ChatMessage[] {
  const messages = normalizeMessages(thread?.messages ?? [])
  if (!messages.length) return []
  const leaf = messages.find((message) => message.id === thread?.activeLeafId) ?? messages.at(-1)
  return pathTo(messages, leaf?.id ?? null)
}

/** The attempts at one turn: same parent, same role. */
export function siblings(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  return normalizeMessages(messages).filter(
    (entry) =>
      (entry.parentId ?? null) === (message.parentId ?? null) && entry.role === message.role,
  )
}

/** Where a message sits among its versions, for a "1 of 2" control. */
export function branchOf(messages: ChatMessage[], message: ChatMessage) {
  const list = siblings(messages, message)
  return {
    ids: list.map((entry) => entry.id),
    index: list.findIndex((entry) => entry.id === message.id),
    count: list.length,
  }
}

/**
 * Where a branch ends: the newest reply under it. Switching branches asks the
 * service for this, so the control lands on the finished turn rather than on the
 * edited message itself.
 */
export function leafOf(messages: ChatMessage[], id: string): string {
  const linkedMessages = normalizeMessages(messages)
  const children = (parent: string) =>
    linkedMessages.filter((message) => (message.parentId ?? null) === parent)
  let current = linkedMessages.find((message) => message.id === id)
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    const next = children(current.id).at(-1)
    if (!next) break
    current = next
  }
  return current?.id ?? id
}
