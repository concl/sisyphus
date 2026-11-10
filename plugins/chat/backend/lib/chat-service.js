const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { z } = require('zod')
const { validateFolder } = require('@sisyphus/native/folder')
const { DEFAULT_LIMITS } = require('./chat-config.js')
const { MAX_MESSAGE_LENGTH, validateConversationInput } = require('./chat-input.js')
const { leafOf, normalizeMessages, pathTo, toolActivity } = require('./chat-tree.js')
const { appendText, appendReasoning, addTool } = require('./transcript.js')
const { DEFAULT_COMPACTION, estimate } = require('./compaction')
const { DEFAULT_HARNESS } = require('../harness/contract')
const { buildHistory } = require('../harness/history')
const { createHarnessRegistry } = require('../harness/registry')
const { createWatchdog } = require('../harness/watchdog')

function allowed(access, required) {
  return access === 'write' || (access === 'read' && required === 'read')
}
// Errors are shown to the user and stored in the transcript. Providers put the
// useful detail in the cause of the SDK's wrapper (or in the API error body),
// so keep the chain of messages rather than only the outermost one.
function safeError(error, key) {
  const messages = []
  for (let current = error; current && messages.length < 3; current = current.cause) {
    const message = current instanceof Error ? current.message : String(current)
    if (!message || messages.includes(message)) break
    messages.push(message)
  }
  const text = messages.join(' -> ') || 'The request failed.'
  return (key ? text.split(key).join('[redacted]') : text).slice(0, 1000)
}
// A timeout reaches us either as the SDK's DOMException (which labels the guard
// that fired), as the cause of a wrapped API error, or as our own watchdog's
// error. Which one it was decides what the user is told: a model going quiet is
// not a slow tool, and neither is a budget the user set.
function timeoutMessage(error) {
  const match = /timeout of (\d+)ms exceeded/i.exec(String(error?.message ?? error ?? ''))
  return match ? Number(match[1]) : null
}
function stallFrom(error) {
  for (let current = error; current; current = current.cause) {
    if (current.stage) return { stage: current.stage, ms: current.ms }
    if (current.name === 'TimeoutError') {
      const label = /^([A-Za-z ]+?) timeout of (\d+)ms exceeded/i.exec(
        String(current.message ?? ''),
      )
      return {
        stage: label && /first/i.test(label[1]) ? 'first' : 'chunk',
        ms: timeoutMessage(current) ?? undefined,
      }
    }
  }
  return null
}
function humanMs(ms) {
  if (!ms) return 'a moment'
  return ms < 1000 ? `${ms}ms` : `${Math.round(ms / 1000)}s`
}
function stallMessage({ stage, ms }) {
  const waited = humanMs(ms)
  if (stage === 'first')
    return `The model did not start replying within ${waited}, so this reply was cut off. Send the message again to retry.`
  return `The model stopped sending data for ${waited}, so this reply was cut off. Send the message again to retry.`
}
// Some OpenAI-compatible servers close the stream without a finish chunk. When
// that happens after content has arrived the reply is still usable, so it is kept
// and explained rather than replaced by an error the user cannot act on.
function isIncompleteStream(error) {
  for (let current = error; current; current = current.cause)
    if (/without a finish chunk|No output generated/i.test(String(current.message ?? current)))
      return true
  return false
}
// A tool may legitimately take minutes (a build, a test run), so a tool that
// overruns its own budget is reported as that tool failing: the model reads the
// error and can carry on, instead of the whole reply dying as a stall.
function toolBudgetError(name, ms) {
  return new Error(
    `The tool ${name} was still running after ${humanMs(ms)}. Raise "Tool seconds per call" in Settings > Chat, or run it yourself.`,
  )
}
function withToolBudget(running, budgetMs, name, cancel = () => {}) {
  if (!budgetMs) return running
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cancel()
      reject(toolBudgetError(name, budgetMs))
    }, budgetMs)
    running.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
// A reply can finish with tool work done and no prose: the step budget ran out,
// or the provider's output budget was spent on hidden reasoning. The app says so
// in its own voice: the note is a `notice`, kept out of `text`, so an explanation
// from the app can never be mistaken for something the model wrote.
function emptyReplyNote({ stepLimit, truncated }, maxSteps) {
  if (truncated)
    return 'The model ran out of its output budget before writing a reply (reasoning counts against it). Send "continue" and it will pick up from here.'
  if (stepLimit)
    return `This reply reached its limit of ${maxSteps} tool steps before writing an answer. Increase the limit in Settings > Chat, or send "continue" and it will pick up from here.`
  return 'The model finished without a text reply. Review the tool activity above.'
}
// A tool result kept for the transcript: enough to audit, never unbounded.
function previewOutput(value, limit = 4000) {
  if (value?.type === 'computer-screenshot') {
    const { data, ...metadata } = value
    return JSON.stringify(metadata, null, 2)
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)
  return text.length > limit ? `${text.slice(0, limit)}\n... truncated` : text
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
// A system note is a part like any other, but the panel renders it as the app's
// own message rather than as model prose.
function noticePart(parts, text) {
  return text ? [...parts, { type: 'notice', text }] : parts
}
// The registry stores Zod schemas in the native process. A harness receives JSON
// Schema, which is the interchange format every model SDK can consume.
function toolParameters(definition) {
  const schema = definition.parameters ?? definition.schema ?? z.toJSONSchema(definition.inputSchema)
  // JSON Schema's `$schema` describes the document, not these arguments. Some
  // providers reject it, so the interchange form leaves it out.
  if (!schema || typeof schema !== 'object' || !('$schema' in schema)) return schema
  const rest = { ...schema }
  delete rest.$schema
  return rest
}
// Attachments: a picture or file the user put in the composer. The bytes live
// beside the conversation (`storage/chat.attachments/<thread>/<id>`) rather than
// inside it, so a conversation file stays small enough to rewrite on every turn
// and can still be moved or deleted on its own.
const ATTACHMENT_ID = /^[\w-]{1,80}$/
const MAX_ATTACHMENTS = 10
/** Ceiling for one payload, generous enough for a resized screenshot. */
const MAX_ATTACHMENT_BYTES = 12_000_000
// The shape a window may send, checked here because it crossed a boundary.
function acceptAttachments(input) {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) throw new Error('Invalid attachments')
  if (input.length > MAX_ATTACHMENTS)
    throw new Error(`A message can carry up to ${MAX_ATTACHMENTS} attachments.`)
  const seen = new Set()
  return input.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid attachment')
    const { id, name, mime, size, kind, preview, data } = entry
    if (typeof id !== 'string' || !ATTACHMENT_ID.test(id) || seen.has(id))
      throw new Error('Invalid attachment')
    seen.add(id)
    if (typeof name !== 'string' || !name.trim() || name.length > 255)
      throw new Error('Invalid attachment name')
    if (kind !== 'image' && kind !== 'file') throw new Error('Invalid attachment kind')
    if (typeof data !== 'string' || !data) throw new Error(`${name} arrived without its contents.`)
    const bytes = Buffer.from(data, 'base64')
    if (!bytes.length) throw new Error(`${name} arrived empty.`)
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`${name} is too large to attach.`)
    return {
      id,
      name: name.trim(),
      mime: typeof mime === 'string' && mime ? mime.slice(0, 120) : 'application/octet-stream',
      size: Number.isFinite(size) && size > 0 ? Math.round(size) : bytes.length,
      kind,
      // A thumbnail the window drew; anything else is not worth carrying.
      preview:
        typeof preview === 'string' && preview.startsWith('data:image/') && preview.length <= 400_000
          ? preview
          : undefined,
      bytes,
    }
  })
}
class ChatService {
  constructor({ history, config, registry, attachments, fetch: fetchOverride, timeouts, harnesses }) {
    this.history = history
    this.config = config
    this.registry = registry
    // Where attachment payloads live, beside the conversations. Optional, so a
    // caller that only reads history needs no directory.
    this.attachments = attachments ?? null
    this.fetchOverride = fetchOverride
    // Production derives these from the configured limits; tests shorten them.
    this.timeouts = { ...timeouts }
    // The registry of runnable harnesses. ChatService itself knows only the
    // normalized conversation and the contract in harness/contract.js.
    this.harnesses = harnesses ?? createHarnessRegistry()
    this.active = new Map()
  }
  list() {
    return this.history.list()
  }
  get(id) {
    const thread = this.history.get(id)
    return thread ? this.publicThread(thread) : null
  }
  save(thread) {
    this.history.save(thread)
  }
  // Provider messages belong to the reply that produced them, so they are stored
  // with it (see chat-tree.js) and never leave the desktop process.
  publicThread(thread) {
    const { modelMessages, ...visible } = thread
    return structuredClone({
      ...visible,
      messages: visible.messages.map(({ model, compactedContext, harness, ...message }) => message),
    })
  }
  // Binds a folder to a stored conversation. Tools read it from the thread on
  // every run, so a change applies to the next message.
  setFolder(id, folder) {
    this.assertIdle(id, 'Stop the reply before changing the folder.')
    const thread = this.requireThread(id)
    thread.folder = usableFolder(folder)
    thread.updatedAt = new Date().toISOString()
    this.save(thread)
    return this.publicThread(thread)
  }
  delete(id) {
    this.assertIdle(id, 'Stop the reply before deleting this conversation.')
    this.history.delete(id)
    this.deleteAttachments(id)
  }
  attachmentFolder(threadId) {
    if (!this.attachments || !ATTACHMENT_ID.test(threadId)) return null
    return path.join(this.attachments, threadId)
  }
  // Payloads are read back by attachment id for every message being replayed,
  // so a picture sent five turns ago reaches the model the same way as this one.
  loadPayloads(threadId, messages, into = new Map()) {
    const folder = this.attachmentFolder(threadId)
    if (!folder) return into
    for (const message of messages)
      for (const attachment of message.attachments ?? []) {
        try {
          into.set(attachment.id, fs.readFileSync(path.join(folder, attachment.id)))
        } catch {
          // A payload that is gone is simply not replayed.
        }
      }
    return into
  }
  saveAttachments(threadId, files) {
    const folder = this.attachmentFolder(threadId)
    if (!folder || !files.length) return
    fs.mkdirSync(folder, { recursive: true })
    for (const file of files) fs.writeFileSync(path.join(folder, file.id), file.bytes)
  }
  deleteAttachments(threadId) {
    const folder = this.attachmentFolder(threadId)
    if (folder) fs.rmSync(folder, { recursive: true, force: true })
  }
  // Switching branches picks a message and follows its newest replies, so the
  // turn that was edited lands on the finished answer rather than on itself.
  selectBranch({ conversationId, messageId }) {
    this.assertIdle(conversationId, 'Stop the reply before switching branches.')
    const thread = this.requireThread(conversationId)
    if (!thread.messages.some((message) => message.id === messageId))
      throw new Error('Message not found')
    thread.activeLeafId = leafOf(thread.messages, messageId)
    thread.updatedAt = new Date().toISOString()
    this.save(thread)
    return this.publicThread(thread)
  }
  cancel(runId, owner) {
    const run = this.active.get(runId)
    if (run?.owner === owner) run.controller.abort()
  }
  assertIdle(id, message) {
    if ([...this.active.values()].some((run) => run.threadId === id)) throw new Error(message)
  }
  requireThread(id) {
    const thread = this.history.get(id)
    if (!thread) throw new Error('Conversation not found')
    return thread
  }
  send(input, owner, emit) {
    return this.reply(input, owner, emit)
  }
  createConversation({ runId, prompt, folder }, owner, emit) {
    const canonicalFolder = validateConversationInput({ prompt, folder })
    return this.reply({ runId, text: prompt }, owner, emit, canonicalFolder)
  }
  // Editing keeps the original message and starts a sibling branch beside it.
  edit({ editMessageId, ...input }, owner, emit) {
    if (!editMessageId) throw new Error('Choose the message to edit.')
    return this.reply({ ...input, editMessageId }, owner, emit)
  }
  async reply(
    { conversationId, editMessageId, text, runId, folder, attachments },
    owner,
    emit,
    canonicalFolder,
  ) {
    if (typeof text !== 'string' || text.length > MAX_MESSAGE_LENGTH)
      throw new Error('A message can be up to 20,000 characters.')
    const files = acceptAttachments(attachments)
    if (!text.trim() && !files.length) throw new Error('Write a message or attach a file.')
    if (typeof runId !== 'string' || !/^[\w-]{1,80}$/.test(runId) || this.active.has(runId))
      throw new Error('Invalid request ID')
    if (conversationId) this.assertIdle(conversationId, 'A reply is already running in this conversation.')
    const settings = this.config.resolve()
    const harness = this.harnesses.get(settings.harness || DEFAULT_HARNESS)
    if (!harness)
      throw new Error(
        `The selected agent harness "${settings.harness}" is not available. Choose another in Settings > Chat.`,
      )
    const limits = { ...DEFAULT_LIMITS, ...settings.limits }
    // 0 means "no limit": the guard is simply not installed. The provider call is
    // only given the first-chunk guard by the watchdog below, which is suspended
    // while one of our tools is working or the harness is preparing context.
    const timings = {
      firstChunkMs: limits.firstChunkSeconds ? limits.firstChunkSeconds * 1000 : undefined,
      chunkMs: limits.chunkSeconds ? limits.chunkSeconds * 1000 : undefined,
      toolMs: limits.toolSeconds ? limits.toolSeconds * 1000 : undefined,
      // Tests shorten the windows; an override is never "no limit".
      ...this.timeouts,
    }
    let thread
    if (conversationId) {
      thread = this.requireThread(conversationId)
      thread.folder = usableFolder(thread.folder)
    } else {
      if (editMessageId) throw new Error('Conversation not found')
      thread = {
        id: randomUUID(),
        // A message that is only a picture still names the conversation.
        title:
          text.trim().slice(0, 60) || (files[0]?.name ?? '').slice(0, 60) || 'New conversation',
        messages: [],
        activeLeafId: null,
        updatedAt: new Date().toISOString(),
        folder: canonicalFolder ?? usableFolder(folder),
      }
    }
    // Where this message attaches. Editing answers the edited message's parent,
    // which puts the new attempt beside the original instead of after it;
    // sending continues from the branch that is on screen.
    let parentId = thread.activeLeafId ?? null
    if (editMessageId) {
      const target = thread.messages.find((message) => message.id === editMessageId)
      if (!target) throw new Error('Message not found')
      if (target.role !== 'user') throw new Error('Only your own messages can be edited.')
      parentId = target.parentId ?? null
    }
    if (parentId && !thread.messages.some((message) => message.id === parentId)) parentId = null
    // Payloads are on disk before anything is saved, so the picture sent this
    // turn and the one sent five turns ago are read back the same way and the
    // branch can be replayed after a reload.
    const user = { id: randomUUID(), role: 'user', text, parentId }
    if (files.length) user.attachments = files.map(({ bytes, ...record }) => record)
    this.saveAttachments(thread.id, files)
    const controller = new AbortController()
    const run = { owner, controller, threadId: thread.id }
    let finish
    run.done = new Promise((resolve) => {
      finish = resolve
    })
    this.active.set(runId, run)
    thread.messages.push(user)
    // The branch on screen follows the message being written.
    thread.activeLeafId = user.id
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
      parentId: user.id,
      text: '',
      reasoning: '',
      tools: [],
      parts: [],
      status: 'complete',
      harness: harness.id,
    }
    let result
    let history = []
    const runContext = { runId, conversationId: thread.id }
    try {
      const branch = pathTo(normalizeMessages(thread.messages), user.id)
      const payloads = this.loadPayloads(thread.id, branch)
      for (const file of files) payloads.set(file.id, file.bytes)
      history = buildHistory(thread.messages, user.id, payloads, DEFAULT_HARNESS)
      // The silence watchdog is generic: every harness reports when it speaks
      // and when it is doing non-model work. Tool work is counted by the wrapper
      // below, so a slow tool is never mistaken for a silent model.
      let rejectStall
      const stall = new Promise((_, reject) => {
        rejectStall = reject
      })
      const watchdog = createWatchdog({
        firstChunkMs: timings.firstChunkMs,
        chunkMs: timings.chunkMs,
        onStall: (stallInfo) => {
          controller.abort()
          rejectStall(stallInfo)
        },
      })
      const tools = this.harnessTools({
        registry: this.registry,
        config: this.config,
        settings,
        assistant,
        emit,
        controller,
        timings,
        runId,
        thread,
        watchdog,
      })
      watchdog.start()
      const request = {
        runId,
        conversationId: thread.id,
        folder: thread.folder ?? null,
        provider: {
          id: settings.provider ?? '',
          baseURL: settings.baseURL,
          model: settings.model,
          apiKey: settings.apiKey,
        },
        systemPrompt: settings.systemPrompt,
        access: settings.access,
        limits: { maxSteps: limits.maxSteps, maxRetries: limits.maxRetries },
        compaction: {
          enabled: settings.compaction?.enabled !== false,
          contextTokens:
            settings.compaction?.contextTokens ?? DEFAULT_COMPACTION.contextTokens,
        },
        messages: history,
        tools,
        fetch: this.fetchOverride,
      }
      const control = {
        signal: controller.signal,
        emit: (event) => {
          if (watchdog.stalled) return
          this.receive(event, { assistant, emit, watchdog })
        },
        beginWork: () => watchdog.beginWork(),
        endWork: () => watchdog.endWork(),
      }
      const running = Promise.resolve().then(() => harness.run(request, control))
      // A harness that ignores its abort signal must not leave an unhandled
      // rejection behind after the watchdog has already ended the reply.
      running.catch(() => {})
      try {
        result = await Promise.race([running, stall])
      } finally {
        watchdog.stop()
      }
      if (controller.signal.aborted) assistant.status = 'stopped'
      if (!assistant.text && assistant.status !== 'stopped') {
        assistant.notice = emptyReplyNote(
          {
            stepLimit: Boolean(result?.stepLimitHit),
            truncated: result?.finishReason === 'length',
          },
          limits.maxSteps,
        )
        assistant.parts = noticePart(assistant.parts, assistant.notice)
      }
    } catch (error) {
      // A stall is checked first: it aborts our own controller on the way out, so
      // it would otherwise read as the user having pressed Stop.
      const stalled = error && typeof error === 'object' && error.stage ? error : stallFrom(error)
      if (stalled) {
        assistant.status = 'error'
        assistant.error = stallMessage(stalled)
      } else if (controller.signal.aborted) {
        assistant.status = 'stopped'
        assistant.error = 'Reply stopped.'
      } else if (isIncompleteStream(error)) {
        // A server that closes the stream early still gave the user an answer.
        if (assistant.text || assistant.parts.length) {
          assistant.status = 'complete'
          assistant.notice =
            'The server closed the connection without finishing this reply, so this may be cut short. Send "continue" and it will pick up from here.'
          assistant.parts = noticePart(assistant.parts, assistant.notice)
        } else {
          assistant.status = 'error'
          assistant.error =
            'The server closed the connection before the model wrote anything. Send the message again to retry.'
        }
      } else {
        assistant.status = 'error'
        assistant.error = safeError(error, settings.apiKey)
      }
    } finally {
      // Release desktop ownership on success, failure, cancellation and reload.
      this.registry.endRun?.(runContext)
      for (const definition of this.registry.list()) definition.endRun?.(runContext)
      if (result?.compactedContext?.length) assistant.compactedContext = result.compactedContext
      // Provider messages hang off the reply that produced them, so a branch
      // replays only its own history.
      if (result?.transcript?.length) assistant.model = result.transcript
      else if ((assistant.text || assistant.tools.length) && harness.id === DEFAULT_HARNESS)
        // The built-in harness can replay this plain assistant message. Another
        // harness gets the normalized fields instead of a transcript shaped for
        // an SDK it does not use.
        assistant.model = [
          {
            role: 'assistant',
            content: assistant.text || toolActivity(assistant.tools),
          },
        ]
      if (!assistant.context) assistant.context = {
        tokens: estimate([
          settings.systemPrompt,
          ...history,
          ...(result?.compactedContext ?? []),
          ...(assistant.model ?? []),
        ]),
        estimated: true,
      }
      // Models that never reason keep the older message shape.
      if (!assistant.reasoning) delete assistant.reasoning
      thread.messages.push(assistant)
      thread.activeLeafId = assistant.id
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
  // Wraps each registry tool with the app-level guarantees every harness gets:
  // current access, an audit record, streamed activity, the per-call budget, and
  // cancellation.
  harnessTools({
    registry,
    config,
    settings,
    assistant,
    emit,
    controller,
    timings,
    runId,
    thread,
    watchdog,
  }) {
    const toolContext = {
      runId,
      folder: thread.folder ?? null,
      conversationId: thread.id,
      signal: controller.signal,
    }
    return registry
      .list()
      .filter((definition) => allowed(settings.access, definition.access))
      .map((definition) => ({
        name: definition.name,
        description: definition.description,
        parameters: toolParameters(definition),
        access: definition.access,
        execute: async (input) => {
          if (controller.signal.aborted) throw new Error('Request stopped')
          if (!allowed(config.get().access, definition.access))
            throw new Error('Tool access was revoked in Settings > Chat')
          const audit = { id: randomUUID(), name: definition.name, input, status: 'running' }
          assistant.tools.push(audit)
          assistant.parts = addTool(assistant.parts, audit.id)
          emit({ type: 'tool', tool: audit })
          watchdog.toolStart()
          try {
            const toolController = new AbortController()
            const output = await withToolBudget(
              definition.execute(input, {
                ...toolContext,
                signal: AbortSignal.any([controller.signal, toolController.signal]),
              }),
              timings.toolMs,
              definition.name,
              () => toolController.abort(),
            )
            audit.status = 'complete'
            audit.output = previewOutput(output)
            emit({ type: 'tool', tool: { ...audit } })
            return output
          } catch (error) {
            audit.status = 'failed'
            audit.output = previewOutput(error instanceof Error ? error.message : String(error))
            emit({ type: 'tool', tool: { ...audit } })
            throw error
          } finally {
            watchdog.toolEnd()
          }
        },
      }))
  }
  // One place where harness events become the panel's event stream and the
  // stored assistant record. A harness cannot write the transcript directly.
  receive(event, { assistant, emit, watchdog }) {
    if (event.type === 'text' && event.text) {
      assistant.text += event.text
      assistant.parts = appendText(assistant.parts, event.text)
      watchdog.noteSpeaking()
      emit({ type: 'text', text: event.text })
      return
    }
    if (event.type === 'reasoning' && event.text) {
      assistant.reasoning += event.text
      assistant.parts = appendReasoning(assistant.parts, event.text)
      watchdog.noteSpeaking()
      emit({ type: 'reasoning', text: event.text })
      return
    }
    if (event.type === 'notice' && event.text) {
      assistant.parts = noticePart(assistant.parts, event.text)
      emit({ type: 'notice', text: event.text })
      return
    }
    if (event.type === 'context' && event.context) {
      assistant.context = event.context
      emit({ type: 'context', context: event.context })
    }
  }
  async dispose() {
    const runs = [...this.active.values()]
    for (const run of runs) run.controller.abort()
    await Promise.all(runs.map((run) => run.done))
  }
}
module.exports = { ChatService, allowed }
