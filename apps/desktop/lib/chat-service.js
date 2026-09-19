const { randomUUID } = require('node:crypto')
const { validateFolder } = require('./chat-folder')

function allowed(access, required) {
  return access === 'write' || (access === 'read' && required === 'read')
}
function safeError(error, key) {
  const message = error instanceof Error ? error.message : String(error)
  return (key ? message.split(key).join('[redacted]') : message).slice(0, 1000)
}
// A tool result kept for the transcript: enough to audit, never unbounded.
function previewOutput(value, limit = 4000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)
  return text.length > limit ? `${text.slice(0, limit)}\n… truncated` : text
}
// Threads keep their folder across restarts; a folder that moved away is
// dropped rather than failing the whole request.
function usableFolder(value) {
  if (!value) return null
  try {
    return validateFolder(value)
  } catch {
    return null
  }
}

class ChatService {
  constructor({ storage, config, registry, fetch: fetchOverride }) {
    this.storage = storage
    this.config = config
    this.registry = registry
    this.fetchOverride = fetchOverride
    this.active = new Map()
  }
  threads() {
    return this.storage.get('chat.history', 'threads.v1') || []
  }
  publicThread(thread) {
    const { modelMessages, ...visible } = thread
    return visible
  }
  list() {
    return this.threads().map((thread) => ({
      id: thread.id,
      title: thread.title,
      updatedAt: thread.updatedAt,
      folder: thread.folder ?? null,
    }))
  }
  get(id) {
    const thread = this.threads().find((entry) => entry.id === id)
    return thread ? this.publicThread(thread) : null
  }
  save(thread) {
    const threads = this.threads().filter((entry) => entry.id !== thread.id)
    this.storage.set('chat.history', 'threads.v1', [thread, ...threads])
  }
  // Binds a folder to a stored conversation. Tools read it from the thread on
  // every run, so a change applies to the next message.
  setFolder(id, folder) {
    if ([...this.active.values()].some((run) => run.threadId === id))
      throw new Error('Stop the reply before changing the folder.')
    const thread = this.threads().find((entry) => entry.id === id)
    if (!thread) throw new Error('Conversation not found')
    thread.folder = usableFolder(folder)
    thread.updatedAt = new Date().toISOString()
    this.save(thread)
    return this.publicThread(thread)
  }
  delete(id) {
    if ([...this.active.values()].some((run) => run.threadId === id))
      throw new Error('Stop the reply before deleting this conversation.')
    this.storage.set(
      'chat.history',
      'threads.v1',
      this.threads().filter((thread) => thread.id !== id),
    )
  }
  cancel(runId, owner) {
    const run = this.active.get(runId)
    if (run?.owner === owner) run.controller.abort()
  }
  async send({ conversationId, text, runId, folder }, owner, emit) {
    if (typeof text !== 'string' || !text.trim() || text.length > 20000)
      throw new Error('Enter a message of 1–20,000 characters.')
    if (typeof runId !== 'string' || !/^[\w-]{1,80}$/.test(runId) || this.active.has(runId))
      throw new Error('Invalid request ID')
    if ([...this.active.values()].some((run) => run.owner === owner))
      throw new Error('A reply is already running.')
    const settings = this.config.resolve()
    const thread = conversationId
      ? this.threads().find((entry) => entry.id === conversationId)
      : {
          id: randomUUID(),
          title: text.trim().slice(0, 60),
          messages: [],
          modelMessages: [],
          updatedAt: new Date().toISOString(),
          folder: usableFolder(folder),
        }
    if (!thread) throw new Error('Conversation not found')
    if (conversationId) thread.folder = usableFolder(thread.folder)
    const controller = new AbortController()
    const run = { owner, controller, threadId: thread.id }
    let finish
    run.done = new Promise((resolve) => {
      finish = resolve
    })
    this.active.set(runId, run)
    const user = { id: randomUUID(), role: 'user', text: text.trim() }
    thread.messages.push(user)
    thread.modelMessages.push({ role: 'user', content: user.text })
    thread.updatedAt = new Date().toISOString()
    try {
      this.save(thread)
      emit({ type: 'start', conversation: this.publicThread(thread) })
    } catch (error) {
      this.active.delete(runId)
      finish()
      throw error
    }
    const assistant = {
      id: randomUUID(),
      role: 'assistant',
      text: '',
      tools: [],
      status: 'complete',
    }
    let response
    try {
      const { ToolLoopAgent, stepCountIs, tool } = await import('ai')
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
      const providerOptions = {
        name: 'configured',
        baseURL: settings.baseURL,
        apiKey: settings.apiKey,
        fetch: (url, options) =>
          (this.fetchOverride || fetch)(url, { ...options, redirect: 'error' }),
      }
      // Use OpenAI's current protocol on its own endpoint; other servers use
      // the broadly supported Chat Completions compatibility protocol.
      const model =
        new URL(settings.baseURL).hostname === 'api.openai.com'
          ? (await import('@ai-sdk/openai')).createOpenAI(providerOptions).responses(settings.model)
          : createOpenAICompatible(providerOptions).chatModel(settings.model)
      const tools = {}
      // Tools receive the conversation context: the folder they may work in and
      // the signal that stops a run.
      const context = {
        folder: thread.folder ?? null,
        conversationId: thread.id,
        signal: controller.signal,
      }
      for (const definition of this.registry.list()) {
        if (!allowed(settings.access, definition.access)) continue
        tools[definition.name] = tool({
          description: definition.description,
          inputSchema: definition.inputSchema,
          execute: async (input) => {
            if (controller.signal.aborted) throw new Error('Request stopped')
            if (!allowed(this.config.get().access, definition.access))
              throw new Error('Tool access was revoked in Settings → Chat')
            const audit = { id: randomUUID(), name: definition.name, input, status: 'running' }
            assistant.tools.push(audit)
            emit({ type: 'tool', tool: audit })
            try {
              const output = await definition.execute(input, context)
              audit.status = 'complete'
              audit.output = previewOutput(output)
              emit({ type: 'tool', tool: { ...audit } })
              return output
            } catch (error) {
              audit.status = 'failed'
              audit.output = previewOutput(error instanceof Error ? error.message : String(error))
              emit({ type: 'tool', tool: { ...audit } })
              throw error
            }
          },
        })
      }
      const agent = new ToolLoopAgent({
        model,
        instructions: `${settings.systemPrompt}\nCurrent local date and time: ${new Date().toString()}. Access level: ${settings.access}. ${thread.folder ? `Conversation folder: ${thread.folder}. File and command tools work inside it and cannot reach anything outside it.` : 'This conversation has no folder yet, so file and command tools will refuse to run until the user chooses one.'}`,
        tools,
        stopWhen: stepCountIs(6),
        maxRetries: 1,
        maxOutputTokens: 4096,
        // Errors are surfaced in the transcript; avoid SDK logging request bodies.
        onError: () => {},
      })
      const result = await agent.stream({
        messages: thread.modelMessages,
        abortSignal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]),
      })
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          assistant.text += part.text
          emit({ type: 'text', text: part.text })
        }
        if (part.type === 'error') throw part.error
      }
      response = await result.response
      if (controller.signal.aborted) assistant.status = 'stopped'
      if (!assistant.text && assistant.status !== 'stopped')
        assistant.text = 'The model finished without a text reply. Review the tool activity above.'
    } catch (error) {
      assistant.status = controller.signal.aborted ? 'stopped' : 'error'
      assistant.error = controller.signal.aborted
        ? 'Reply stopped.'
        : safeError(error, settings.apiKey)
    } finally {
      if (response?.messages?.length) thread.modelMessages.push(...response.messages)
      else if (assistant.text || assistant.tools.length)
        thread.modelMessages.push({
          role: 'assistant',
          content:
            assistant.text ||
            `Tool activity: ${assistant.tools.map((entry) => `${entry.name}: ${entry.status}`).join(', ')}`,
        })
      thread.messages.push(assistant)
      thread.updatedAt = new Date().toISOString()
      try {
        this.save(thread)
      } finally {
        this.active.delete(runId)
        finish()
      }
    }
    return this.publicThread(thread)
  }
  async dispose() {
    const runs = [...this.active.values()]
    for (const run of runs) run.controller.abort()
    await Promise.all(runs.map((run) => run.done))
  }
}
module.exports = { ChatService, allowed }
