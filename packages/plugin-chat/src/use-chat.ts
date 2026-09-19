import { useEffect, useRef, useState } from 'react'
import type { ChatConfig, ChatThread, ChatToolActivity, Desktop } from '@sisyphus/sdk'
import type { ChatEvent, ThreadSummary } from './types'

/**
 * Conversation state for the chat block: the thread list, the open thread, the
 * live reply for the current run, and the actions the panel can trigger.
 */
export function useChat(desktop: Desktop) {
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [thread, setThread] = useState<ChatThread | null>(null)
  const [config, setConfig] = useState<ChatConfig | null>(null)
  const [reply, setReply] = useState('')
  const [activity, setActivity] = useState<ChatToolActivity[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Folder to attach to the next message. Empty until the user attaches one to
  // this conversation: chats have no folder unless they are given one.
  const [draftFolder, setDraftFolder] = useState<string | null>(null)
  const run = useRef<string | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    void desktop
      .call<ThreadSummary[]>('chat.list')
      .then((result) => {
        if (alive.current) setThreads(result)
      })
      .catch((problem) => {
        if (alive.current) setError(String(problem))
      })
    void desktop
      .call<ChatConfig>('chat.config.get')
      .then((result) => {
        if (alive.current) setConfig(result)
      })
      .catch(() => {})
    const offConfig = desktop.on<ChatConfig>('chat.config.changed', setConfig)
    const off = desktop.on<ChatEvent>('chat.event', (event) => {
      // Only the run this panel started belongs in this panel.
      if (event.runId !== run.current) return
      if (event.type === 'start' && event.conversation) setThread(event.conversation)
      if (event.type === 'text') setReply((value) => value + (event.text ?? ''))
      if (event.type === 'tool' && event.tool) {
        const tool = event.tool
        setActivity((items) =>
          items.some((item) => item.id === tool.id)
            ? items.map((item) => (item.id === tool.id ? tool : item))
            : [...items, tool],
        )
      }
    })
    return () => {
      alive.current = false
      off()
      offConfig()
      if (run.current) void desktop.call('chat.cancel', { runId: run.current }).catch(() => {})
    }
  }, [desktop])

  async function refreshThreads() {
    const result = await desktop.call<ThreadSummary[]>('chat.list')
    if (alive.current) setThreads(result)
  }

  async function openThread(id: string) {
    try {
      // A new conversation starts unbound; the folder lives on the thread.
      if (!id) setDraftFolder(null)
      setThread(id ? await desktop.call<ChatThread>('chat.get', { id }) : null)
      setError('')
    } catch (problem) {
      setError(String(problem))
    }
  }

  async function removeThread() {
    if (!thread) return
    try {
      await desktop.call('chat.delete', { id: thread.id })
      setThread(null)
      await refreshThreads()
    } catch (problem) {
      setError(String(problem))
    }
  }

  // Binds the conversation to a folder through the OS picker. An open thread is
  // updated immediately; otherwise the choice seeds the next new conversation.
  async function chooseFolder() {
    try {
      const result = await desktop.call<{ folder: string | null; canceled?: boolean }>(
        'chat.folder.choose',
      )
      if (!alive.current || result.canceled || !result.folder) return
      setDraftFolder(result.folder)
      if (thread)
        setThread(
          await desktop.call<ChatThread>('chat.setFolder', {
            id: thread.id,
            folder: result.folder,
          }),
        )
    } catch (problem) {
      if (alive.current) setError(String(problem))
    }
  }

  async function send(text: string) {
    if (!text.trim() || busy) return false
    const runId = crypto.randomUUID()
    run.current = runId
    setReply('')
    setActivity([])
    setError('')
    setBusy(true)
    try {
      const result = await desktop.call<ChatThread>('chat.send', {
        conversationId: thread?.id,
        text,
        runId,
        folder: draftFolder ?? undefined,
      })
      if (alive.current) {
        setThread(result)
        await refreshThreads()
      }
      return true
    } catch (problem) {
      // The composer keeps the draft so the message is not lost.
      if (alive.current) setError(String(problem))
      return false
    } finally {
      run.current = null
      if (alive.current) {
        setBusy(false)
        setReply('')
        setActivity([])
      }
    }
  }

  function stop() {
    if (run.current) void desktop.call('chat.cancel', { runId: run.current }).catch(() => {})
  }

  return {
    threads,
    thread,
    config,
    reply,
    activity,
    busy,
    error,
    folder: thread?.folder ?? draftFolder,
    openThread,
    removeThread,
    chooseFolder,
    send,
    stop,
  }
}
