import { useEffect, useSyncExternalStore } from 'react'
import type { ChatMessage, Desktop } from '@sisyphus/sdk'
import { chatStore } from './chat-store'
import { EMPTY_TRANSCRIPT } from './transcript'
import { activePath } from './tree'

/**
 * Binds the chat block to the shared chat store (`chat-store.ts`). Nothing that
 * matters lives here: the workspace can destroy and rebuild a block at any time,
 * so the conversation and the streaming reply belong to the store.
 */
export function useChat(desktop: Desktop) {
  const store = chatStore(desktop)
  const session = useSyncExternalStore(store.subscribe, store.getSnapshot)

  useEffect(() => {
    void store.load()
  }, [store])

  const run = session.run
  const threadId = session.thread?.id ?? null
  // A reply belongs to the conversation that started it, so it is only rendered
  // in that conversation.
  const live = run && run.threadId === threadId ? run.live : EMPTY_TRANSCRIPT
  const messages = session.thread ? activePath(session.thread) : []
  const context = run?.context ?? [...messages].reverse().find(message => message.context)?.context

  return {
    threads: session.threads,
    runningIds: session.runningIds,
    context,
    thread: session.thread,
    config: session.config,
    live,
    busy: Boolean(run),
    error: session.error,
    /** The message being edited, or null. Send saves it as a new branch. */
    editing: session.editing,
    folder: session.thread?.folder ?? session.draftFolder,
    openThread: (id: string) => void store.open(id || null),
    removeThread: () => void store.remove(),
    chooseFolder: () => void store.chooseFolder(),
    attachFolder: (folder: string) => store.attachFolder(folder),
    send: (text: string) => store.send(text),
    submitEdit: (text: string) => store.submitEdit(text),
    startEdit: (message: ChatMessage) => store.startEdit(message),
    cancelEdit: () => store.cancelEdit(),
    switchBranch: (message: ChatMessage) => store.switchBranch(message),
    stop: () => store.stop(),
  }
}
