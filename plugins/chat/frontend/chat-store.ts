import type { ChatConfig, ChatContext, ChatMessage, ChatThread, Desktop } from '@sisyphus/sdk'
import type { ChatEvent, ThreadSummary } from './types'
import {
  appendReasoning,
  appendText,
  updateTool,
  EMPTY_TRANSCRIPT,
  type LiveTranscript,
} from './transcript'

/** A reply that is still streaming from the desktop service. */
export interface ChatRun {
  runId: string
  /** The conversation it belongs to; null until the run reports its id. */
  threadId: string | null
  live: LiveTranscript
  context?: ChatContext
  view?: number
}

/** The message being edited, with the text it was written with. */
export interface ChatEdit {
  id: string
  text: string
}

/** Everything the chat block renders. */
export interface ChatSession {
  threads: ThreadSummary[]
  /** The conversation on screen, as last read or reported by a running reply. */
  thread: ChatThread | null
  /** Id of the conversation to reopen when the block is rebuilt. */
  threadId: string | null
  config: ChatConfig | null
  /** Folder to bind to the next message of a conversation that has none yet. */
  draftFolder: string | null
  run: ChatRun | null
  runningIds: string[]
  /** Set while a sent message is being edited; sending saves it as a new branch. */
  editing: ChatEdit | null
  error: string
}

const EMPTY: ChatSession = {
  threads: [],
  thread: null,
  threadId: null,
  config: null,
  draftFolder: null,
  run: null,
  runningIds: [],
  editing: null,
  error: '',
}

/**
 * Chat state for the renderer, deliberately outside React.
 *
 * Dockview destroys a block when it is hidden, so a panel-local run would be
 * cancelled - and its transcript lost - the moment the user looks at another
 * block. This store owns the conversation and the streaming reply instead, and
 * keeps listening for `chat.event` even while no panel is mounted, so a reply
 * runs to completion and is still there when the block comes back.
 */
export class ChatStore {
  private desktop: Desktop
  private newRunId: () => string
  private session: ChatSession = EMPTY
  private listeners = new Set<() => void>()
  private attached = false
  private runs = new Map<string, ChatRun>()
  private conversations = new Map<string, ChatThread>()
  private selection = 0
  private frame: ReturnType<typeof setTimeout> | null = null
  private cleanup: Array<() => void> = []

  constructor(desktop: Desktop, newRunId: () => string = () => crypto.randomUUID()) {
    this.desktop = desktop
    this.newRunId = newRunId
  }

  subscribe = (listener: () => void): (() => void) => {
    this.attach()
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): ChatSession => this.session

  private update(patch: Partial<ChatSession>, streaming = false) {
    this.session = { ...this.session, ...patch }
    if (streaming) {
      this.frame ??= setTimeout(() => {
        this.frame = null
        for (const listener of this.listeners) listener()
      }, 32)
      return
    }
    if (this.frame) clearTimeout(this.frame)
    this.frame = null
    for (const listener of this.listeners) listener()
  }

  private selectedRun() {
    return [...this.runs.values()].find(run => run.threadId === this.session.threadId &&
      (run.threadId !== null || run.view === this.selection)) ?? null
  }

  private publishRuns(streaming = false) {
    this.update({ run: this.selectedRun(), runningIds: [...this.runs.values()].flatMap(run => run.threadId ? [run.threadId] : []) }, streaming)
  }

  /** One subscription for the life of the window, not for the life of a block. */
  private attach() {
    if (this.attached) return
    this.attached = true
    this.cleanup.push(this.desktop.on<ChatConfig>('chat.config.changed', (config) => this.update({ config })))
    this.cleanup.push(this.desktop.on<ChatEvent>('chat.event', (event) => this.receive(event)))
  }

  dispose() {
    for (const off of this.cleanup) off()
    this.cleanup = []
    this.attached = false
    if (this.frame) clearTimeout(this.frame)
    this.frame = null
    this.listeners.clear()
  }

  private receive(event: ChatEvent) {
    const run = this.runs.get(event.runId)
    // Events for a run this window did not start do not belong to this store.
    if (!run || event.runId !== run.runId) return
    if (event.type === 'start' && event.conversation) {
      const conversation = event.conversation
      const selected = this.session.run?.runId === run.runId
      this.conversations.set(conversation.id, conversation)
      this.runs.set(run.runId, { ...run, threadId: conversation.id })
      if (selected) this.update({ thread: conversation, threadId: conversation.id, error: '' })
      this.publishRuns()
      void this.refresh()
      return
    }
    if (event.type === 'reasoning' && event.text)
      this.runs.set(run.runId, { ...run, live: { ...run.live, parts: appendReasoning(run.live.parts, event.text) } })
    if (event.type === 'text' && event.text)
      this.runs.set(run.runId, { ...run, live: { ...run.live, parts: appendText(run.live.parts, event.text) } })
    if (event.type === 'tool' && event.tool) {
      const tool = event.tool
      this.runs.set(run.runId, { ...run, live: updateTool(run.live, tool) })
    }
    if (event.type === 'context' && event.context)
      this.runs.set(run.runId, { ...run, context: event.context })
    if (this.session.threadId === run.threadId) this.publishRuns(true)
  }

  /** Reads the conversation list and settings, and reopens the open conversation. */
  async load() {
    this.attach()
    const refreshing = this.session.threadId ? this.open(this.session.threadId) : undefined
    const listed = this.desktop.call<ThreadSummary[]>('chat.list').then(
      (threads) => this.update({ threads }),
      (problem) => this.update({ error: String(problem) }),
    )
    const configured = this.desktop.call<ChatConfig>('chat.config.get').then(
      (config) => this.update({ config }),
      () => {},
    )
    await Promise.all([refreshing, listed, configured])
  }

  /** Opens a stored conversation, or the empty composer when `id` is null. */
  async open(id: string | null) {
    this.attach()
    const selection = ++this.selection
    this.update({ threadId: id, thread: id ? this.conversations.get(id) ?? null : null,
      draftFolder: null, editing: null, error: '' })
    this.publishRuns()
    if (!id) {
      // A new conversation starts unbound; the folder lives on the thread.
      this.update({ threadId: null, thread: null, draftFolder: null, editing: null, error: '' })
      return
    }
    try {
      const thread = await this.desktop.call<ChatThread | null>('chat.get', { id })
      if (!thread) throw new Error('Conversation not found')
      if (selection !== this.selection) return
      this.conversations.set(id, thread)
      this.update({ threadId: thread.id, thread, editing: null, error: '' })
      this.publishRuns()
    } catch (problem) {
      if (selection === this.selection) this.update({ error: String(problem) })
    }
  }

  async refresh() {
    try {
      this.update({ threads: await this.desktop.call<ThreadSummary[]>('chat.list') })
    } catch (problem) {
      this.update({ error: String(problem) })
    }
  }

  async remove() {
    const thread = this.session.thread
    if (!thread) return
    try {
      await this.desktop.call('chat.delete', { id: thread.id })
      this.update({ threadId: null, thread: null, editing: null })
      await this.refresh()
    } catch (problem) {
      this.update({ error: String(problem) })
    }
  }

  // Binds the conversation to a folder through the OS picker. An open thread is
  // updated immediately; otherwise the choice seeds the next new conversation.
  async chooseFolder() {
    try {
      const result = await this.desktop.call<{ folder: string | null; canceled?: boolean }>(
        'chat.folder.choose',
      )
      if (result.canceled || !result.folder) return
      await this.attachFolder(result.folder)
    } catch (problem) {
      this.update({ error: String(problem) })
    }
  }

  async attachFolder(folder: string): Promise<boolean> {
    const thread = this.session.thread
    try {
      const bound = thread
        ? await this.desktop.call<ChatThread>('chat.setFolder', { id: thread.id, folder })
        : null
      this.update({ draftFolder: folder, thread: bound, error: '' })
      return true
    } catch (problem) {
      this.update({ error: String(problem) })
      return false
    }
  }

  /** Puts a sent message into the composer for editing; nothing is written yet. */
  startEdit(message: ChatMessage) {
    if (this.session.run) return
    this.update({
      editing: { id: message.id, text: message.text },
      error: '',
    })
  }

  cancelEdit() {
    this.update({ editing: null })
  }

  /** Shows a different attempt at the same turn. */
  async switchBranch(message: ChatMessage): Promise<boolean> {
    const thread = this.session.thread
    if (!thread || this.session.run) return false
    try {
      const switched = await this.desktop.call<ChatThread>('chat.branch', {
        conversationId: thread.id,
        messageId: message.id,
      })
      this.update({ thread: switched, error: '' })
      return true
    } catch (problem) {
      this.update({ error: String(problem) })
      return false
    }
  }

  /** Sends a message and keeps the streaming reply in `run` until it settles. */
  async send(text: string): Promise<boolean> {
    this.update({ editing: null })
    return this.submit('chat.send', text)
  }

  /**
   * Saves the message being edited. The original stays in the conversation as the
   * previous branch, so nothing the user wrote is ever destroyed.
   */
  async submitEdit(text: string): Promise<boolean> {
    const editing = this.session.editing
    if (!editing) return this.send(text)
    return this.submit('chat.edit', text, { editMessageId: editing.id })
  }

  private async submit(
    method: 'chat.send' | 'chat.edit',
    text: string,
    extra: Record<string, unknown> = {},
  ): Promise<boolean> {
    if (!text.trim() || this.session.run) return false
    const runId = this.newRunId()
    this.attach()
    const threadId = this.session.thread?.id ?? this.session.threadId
    const selection = this.selection
    this.runs.set(runId, { runId, threadId: threadId ?? null, live: EMPTY_TRANSCRIPT, view: selection })
    this.publishRuns()
    this.update({ error: '' })
    try {
      const thread = await this.desktop.call<ChatThread>(method, {
        conversationId: threadId,
        text,
        runId,
        folder: this.session.draftFolder ?? undefined,
        ...extra,
      })
      this.runs.delete(runId)
      this.conversations.set(thread.id, thread)
      if (this.session.threadId === thread.id || selection === this.selection)
        this.update({ threadId: thread.id, thread, editing: null })
      this.publishRuns()
      await this.refresh()
      return true
    } catch (problem) {
      // The composer keeps the draft (and the edit) so nothing is lost.
      this.runs.delete(runId)
      if (selection === this.selection) this.update({ error: String(problem) })
      this.publishRuns()
      return false
    }
  }

  stop() {
    const run = this.session.run
    if (run) void this.desktop.call('chat.cancel', { runId: run.runId }).catch(() => {})
  }
}

const stores = new WeakMap<Desktop, ChatStore>()
export function releaseChatStore(desktop: Desktop) {
  stores.get(desktop)?.dispose()
  stores.delete(desktop)
}

/**
 * The store for this renderer. Blocks come and go, but they share one instance,
 * so reopening the chat block lands on the same conversation with the same
 * reply still streaming.
 */
export function chatStore(desktop: Desktop): ChatStore {
  const existing = stores.get(desktop)
  if (existing) return existing
  const store = new ChatStore(desktop)
  stores.set(desktop, store)
  return store
}
