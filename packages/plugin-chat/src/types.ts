import type { ChatThread, ChatToolActivity } from '@sisyphus/sdk'

/** List payload: everything a conversation row needs, without the messages. */
export type ThreadSummary = Omit<ChatThread, 'messages'>

/** Streamed progress for the run the panel started. */
export type ChatEvent = {
  runId: string
  type: string
  text?: string
  tool?: ChatToolActivity
  conversation?: ChatThread
}
