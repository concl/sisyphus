import { describe, expect, it } from 'vitest'
import type { ChatThread, Desktop } from '@sisyphus/sdk'
import { ChatStore } from '../../../plugins/chat/src/chat-store'
import type { ChatEvent } from '../../../plugins/chat/src/types'

const CONVERSATION: ChatThread = {
  id: 'thread-1',
  title: 'Plan my day',
  updatedAt: new Date(0).toISOString(),
  messages: [{ id: 'm1', role: 'user', text: 'Plan my day' }],
  folder: null,
}

/** A stand-in for the preload bridge: records calls and replays events. */
function bridge() {
  const calls: Array<{ method: string; input?: Record<string, unknown> }> = []
  const listeners = new Map<string, Set<(value: unknown) => void>>()
  const pending = new Map<string, (thread: ChatThread) => void>()
  const runs = new Map<string, (thread: ChatThread) => void>()
  let rejectEdits = false
  const desktop: Desktop = {
    call<T>(method: string, input?: unknown): Promise<T> {
      calls.push({ method, input: input as Record<string, unknown> | undefined })
      // Sending and editing settle when the test says the reply came back.
      if (method === 'chat.send' || method === 'chat.edit')
        return new Promise((resolve, reject) => {
          if (method === 'chat.edit' && rejectEdits)
            reject(new Error('The edit could not be saved.'))
          else {
            pending.set(method, resolve as (thread: ChatThread) => void)
            runs.set((input as { runId: string }).runId, resolve as (thread: ChatThread) => void)
          }
        })
      if (method === 'chat.get') return Promise.resolve({ ...CONVERSATION, id: (input as { id: string }).id } as T)
      if (method === 'chat.branch') return Promise.resolve(CONVERSATION as T)
      if (method === 'chat.list') return Promise.resolve([] as T)
      return Promise.resolve(undefined as T)
    },
    on<T>(event: string, listener: (value: T) => void) {
      const set = listeners.get(event) ?? new Set()
      set.add(listener as (value: unknown) => void)
      listeners.set(event, set)
      return () => set.delete(listener as (value: unknown) => void)
    },
    dropFiles: () => Promise.reject(new Error('unused')),
  }
  return {
    desktop,
    calls,
    emit: (event: string, value: unknown) => {
      for (const listener of listeners.get(event) ?? []) listener(value)
    },
    finishSend: (thread: ChatThread) => pending.get('chat.send')?.(thread),
    finishRun: (id: string, thread: ChatThread) => runs.get(id)?.(thread),
    finishEdit: (thread: ChatThread) => pending.get('chat.edit')?.(thread),
    failEdits: () => {
      rejectEdits = true
    },
  }
}

function runEvent(runId: string, event: Omit<ChatEvent, 'runId'>): ChatEvent {
  return { runId, ...event }
}

describe('chat store', () => {
  it('runs two conversations independently and does not switch views when a background reply finishes', async () => {
    const { desktop, emit, finishRun, calls } = bridge()
    let id = 0
    const store = new ChatStore(desktop, () => `run-${++id}`)
    await store.open('thread-1')
    const first = store.send('First')
    emit('chat.event', runEvent('run-1', { type: 'start', conversation: CONVERSATION }))
    await store.open('thread-2')
    const second = store.send('Second')
    emit('chat.event', runEvent('run-2', { type: 'start', conversation: { ...CONVERSATION, id: 'thread-2' } }))
    emit('chat.event', runEvent('run-1', { type: 'text', text: 'First reply' }))
    emit('chat.event', runEvent('run-2', { type: 'text', text: 'Second reply' }))
    expect(store.getSnapshot().runningIds).toEqual(['thread-1', 'thread-2'])
    expect(store.getSnapshot().run?.live.parts).toEqual([{ type: 'text', text: 'Second reply' }])
    store.stop()
    expect(calls.at(-1)?.input).toEqual({ runId: 'run-2' })
    finishRun('run-1', CONVERSATION)
    await first
    expect(store.getSnapshot().threadId).toBe('thread-2')
    expect(store.getSnapshot().run?.runId).toBe('run-2')
    finishRun('run-2', { ...CONVERSATION, id: 'thread-2' })
    await second
    expect(store.getSnapshot().runningIds).toEqual([])
  })

  it('keeps streaming a reply while no chat block is mounted', async () => {
    const { desktop, emit, finishSend } = bridge()
    const store = new ChatStore(desktop, () => 'run-1')
    let changes = 0
    const unsubscribe = store.subscribe(() => {
      changes++
    })
    const sending = store.send('Plan my day')
    expect(store.getSnapshot().run?.runId).toBe('run-1')
    emit('chat.event', runEvent('run-1', { type: 'start', conversation: CONVERSATION }))
    emit('chat.event', runEvent('run-1', { type: 'text', text: 'Thinking ' }))
    emit('chat.event', runEvent('run-1', { type: 'reasoning', text: 'What first?' }))
    emit('chat.event', runEvent('run-1', { type: 'text', text: 'about it.' }))

    // Dockview destroys the block: the panel stops listening, the reply does not stop.
    unsubscribe()
    const before = changes
    emit('chat.event', runEvent('run-1', { type: 'text', text: ' Done.' }))
    expect(changes).toBe(before)
    expect(store.getSnapshot().run?.live.parts).toEqual([
      { type: 'text', text: 'Thinking ' },
      { type: 'reasoning', text: 'What first?' },
      { type: 'text', text: 'about it. Done.' },
    ])

    // Reopening the block finds the reply it missed, still streaming.
    const remount = store.subscribe(() => {})
    expect(store.getSnapshot().run?.threadId).toBe('thread-1')
    remount()

    finishSend({ ...CONVERSATION, messages: [...CONVERSATION.messages] })
    await sending
    expect(store.getSnapshot().run).toBeNull()
    expect(store.getSnapshot().threadId).toBe('thread-1')
  })

  it('reopens the conversation that a hidden block left behind', async () => {
    const { desktop, emit, finishSend, calls } = bridge()
    const store = new ChatStore(desktop, () => 'run-1')
    const sending = store.send('Plan my day')
    emit('chat.event', runEvent('run-1', { type: 'start', conversation: CONVERSATION }))
    finishSend(CONVERSATION)
    await sending
    // Losing the block must never look like the user pressing Stop.
    expect(calls.some((call) => call.method === 'chat.cancel')).toBe(false)

    // The rebuilt block re-reads the conversation it was showing.
    await store.load()
    expect(calls.find((call) => call.method === 'chat.get')?.input).toEqual({ id: 'thread-1' })
    expect(store.getSnapshot().thread?.id).toBe('thread-1')
  })

  it('edits a message in its own place and saves it as a new version', async () => {
    const { desktop, calls, finishEdit } = bridge()
    const store = new ChatStore(desktop, () => 'run-edit')
    await store.open('thread-1')

    store.startEdit(CONVERSATION.messages[0])
    // Which message is being edited travels with its text, and nothing is written
    // until the new version is sent.
    expect(store.getSnapshot().editing).toEqual({ id: 'm1', text: 'Plan my day' })
    expect(calls.some((call) => call.method === 'chat.edit')).toBe(false)

    const saving = store.submitEdit('Plan my week instead')
    expect(calls.at(-1)).toEqual({
      method: 'chat.edit',
      input: {
        conversationId: 'thread-1',
        text: 'Plan my week instead',
        runId: 'run-edit',
        editMessageId: 'm1',
      },
    })
    finishEdit(CONVERSATION)
    expect(await saving).toBe(true)
    expect(store.getSnapshot().editing).toBeNull()
  })

  it('keeps an unsaved edit open when the new version cannot be sent', async () => {
    const { desktop, failEdits } = bridge()
    const store = new ChatStore(desktop, () => 'run-edit')
    await store.open('thread-1')
    store.startEdit(CONVERSATION.messages[0])
    failEdits()
    // Nothing the user wrote is thrown away by a failed request.
    expect(await store.submitEdit('Changed my mind')).toBe(false)
    expect(store.getSnapshot().editing).toEqual({ id: 'm1', text: 'Plan my day' })
    expect(store.getSnapshot().error).toMatch(/could not be saved/)
  })

  it('switches a turn between the versions of it', async () => {
    const { desktop, calls } = bridge()
    const store = new ChatStore(desktop, () => 'run-branch')
    await store.open('thread-1')
    expect(await store.switchBranch(CONVERSATION.messages[0])).toBe(true)
    expect(calls.at(-1)).toEqual({
      method: 'chat.branch',
      input: { conversationId: 'thread-1', messageId: 'm1' },
    })
    expect(store.getSnapshot().thread?.id).toBe('thread-1')
    expect(store.getSnapshot().error).toBe('')
  })

  it('answers a stop with the running request id, and one reply at a time', async () => {
    const { desktop, calls, finishSend } = bridge()
    const store = new ChatStore(desktop, () => 'run-1')
    store.stop()
    expect(calls.some((call) => call.method === 'chat.cancel')).toBe(false)

    const sending = store.send('Plan my day')
    expect(await store.send('again')).toBe(false)
    expect(calls.filter((call) => call.method === 'chat.send')).toHaveLength(1)
    store.stop()
    expect(calls.filter((call) => call.method === 'chat.cancel')).toEqual([
      { method: 'chat.cancel', input: { runId: 'run-1' } },
    ])

    finishSend(CONVERSATION)
    await sending
    expect(store.getSnapshot().error).toBe('')
  })
})
