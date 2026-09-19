import type { ChatMessage, ChatMessagePart, ChatToolActivity } from '@sisyphus/sdk'

/**
 * Ordering for a reply that is still streaming. The desktop side records the
 * same order for stored replies (apps/desktop/lib/transcript.js).
 */
export interface LiveTranscript {
  parts: ChatMessagePart[]
  tools: ChatToolActivity[]
}

/** A reply with nothing in it yet. Shared so every empty state compares equal. */
export const EMPTY_TRANSCRIPT: LiveTranscript = { parts: [], tools: [] }

export function appendText(parts: ChatMessagePart[], text: string): ChatMessagePart[] {
  if (!text) return parts
  const last = parts.at(-1)
  return last?.type === 'text'
    ? [...parts.slice(0, -1), { type: 'text', text: last.text + text }]
    : [...parts, { type: 'text', text }]
}

/** Reasoning streams like text but stays separable, so the UI can fold it away. */
export function appendReasoning(parts: ChatMessagePart[], text: string): ChatMessagePart[] {
  if (!text) return parts
  const last = parts.at(-1)
  return last?.type === 'reasoning'
    ? [...parts.slice(0, -1), { type: 'reasoning', text: last.text + text }]
    : [...parts, { type: 'reasoning', text }]
}

export function updateTool(state: LiveTranscript, tool: ChatToolActivity): LiveTranscript {
  const existing = state.tools.some((item) => item.id === tool.id)
  return {
    parts: existing ? state.parts : [...state.parts, { type: 'tool', toolId: tool.id }],
    tools: existing
      ? state.tools.map((item) => (item.id === tool.id ? tool : item))
      : [...state.tools, tool],
  }
}

// Old conversations did not record ordering. Keep their established display;
// never guess tool positions from prose or discard the original audits.
export function messageParts(
  message: Pick<ChatMessage, 'parts' | 'text' | 'tools' | 'reasoning'>,
): ChatMessagePart[] {
  return (
    message.parts ?? [
      ...(message.reasoning ? [{ type: 'reasoning' as const, text: message.reasoning }] : []),
      ...(message.tools ?? []).map((tool): ChatMessagePart => ({ type: 'tool', toolId: tool.id })),
      ...(message.text ? [{ type: 'text' as const, text: message.text }] : []),
    ]
  )
}
