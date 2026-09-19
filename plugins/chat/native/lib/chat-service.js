const { randomUUID } = require('node:crypto')
const { validateFolder } = require('@sisyphus/native/folder')
const { DEFAULT_LIMITS } = require('./chat-config.js')
const { leafOf, modelContext, toolActivity } = require('./chat-tree.js')
const { appendText, appendReasoning, addTool } = require('./transcript.js')

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
// The reply's own stall watchdog, used instead of the SDK's chunk timeout. The
// SDK's timer keeps running while a tool executes - tools run inside its stream
// pipeline - so a slow tool looked exactly like a silent model, and the reply was
// cut off mid-work with the model blamed for it. This clock restarts on every
// stream part and is suspended while one of our tools is working, which is the
// only thing allowed to be slow without the model talking.
class StallError extends Error {
  constructor(stage, ms) {
    super(`${stage} timeout of ${Math.round(ms)}ms exceeded`)
    this.name = 'TimeoutError'
    this.stage = stage
    this.ms = ms
  }
}
// Parts that mean the model (or one of its tools) actually said something. The
// SDK also emits bookkeeping parts (`start`, `start-step`, …) before anything is
// written; those must not count as the reply having started, or a server that
// never answers would be judged against the wrong window.
const SPEAKING_PARTS = new Set([
  'text-delta',
  'reasoning-delta',
  'tool-input-start',
  'tool-call',
  'tool-result',
  'tool-error',
])
const SILENCE = Symbol('silence')
function silenceAfter(ms) {
  let timer
  const promise = new Promise((resolve) => {
    timer = setTimeout(() => resolve(SILENCE), ms)
  })
  return {
    promise,
    clear: () => clearTimeout(timer),
  }
}
// A tool may legitimately take minutes (a build, a test run), so a tool that
// overruns its own budget is reported as that tool failing: the model reads the
// error and can carry on, instead of the whole reply dying as a stall.
function toolBudgetError(name, ms) {
  return new Error(
    `The tool ${name} was still running after ${humanMs(ms)}. Raise "Tool seconds per call" in Settings > Chat, or run it yourself.`,
  )
}
function withToolBudget(running, budgetMs, name) {
  if (!budgetMs) return running
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(toolBudgetError(name, budgetMs)), budgetMs)
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

class ChatService {
  constructor({ history, config, registry, fetch: fetchOverride, timeouts }) {
    this.history = history
    this.config = config
    this.registry = registry
    this.fetchOverride = fetchOverride
    // Production derives these from the configured limits; tests shorten them.
    this.timeouts = { ...timeouts }
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
      messages: visible.messages.map(({ model, ...message }) => message),
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
  // Editing keeps the original message and starts a sibling branch beside it.
  edit({ editMessageId, ...input }, owner, emit) {
    if (!editMessageId) throw new Error('Choose the message to edit.')
    return this.reply({ ...input, editMessageId }, owner, emit)
  }
  async reply({ conversationId, editMessageId, text, runId, folder }, owner, emit) {
    if (typeof text !== 'string' || !text.trim() || text.length > 20000)
      throw new Error('Enter a message of 1-20,000 characters.')
    if (typeof runId !== 'string' || !/^[\w-]{1,80}$/.test(runId) || this.active.has(runId))
      throw new Error('Invalid request ID')
    if (conversationId) this.assertIdle(conversationId, 'A reply is already running in this conversation.')
    const settings = this.config.resolve()
    const limits = { ...DEFAULT_LIMITS, ...settings.limits }
    // 0 means "no limit": the guard is simply not installed, which is the
    // default so a reply is never cut short by a budget nobody asked for. The
    // provider call is only given the first-chunk guard, because nothing of ours
    // can be running before the model has said something. Silence between
    // chunks is watched below instead: the SDK's own chunk timer also counts the
    // time a tool spends working (tools run inside its stream pipeline), which is
    // what made a slow tool look like a stalled model.
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
        title: text.trim().slice(0, 60),
        messages: [],
        activeLeafId: null,
        updatedAt: new Date().toISOString(),
        folder: usableFolder(folder),
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
    // The provider only ever sees the branch this message continues, ending with
    // the message being sent.
    const context = [
      ...modelContext(thread.messages, parentId),
      { role: 'user', content: text.trim() },
    ]
    const controller = new AbortController()
    const run = { owner, controller, threadId: thread.id }
    let finish
    run.done = new Promise((resolve) => {
      finish = resolve
    })
    this.active.set(runId, run)
    const user = { id: randomUUID(), role: 'user', text: text.trim(), parentId }
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
    }
    let response
    try {
      const { ToolLoopAgent, tool } = await import('ai')
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
      const providerOptions = {
        name: 'configured',
        baseURL: settings.baseURL,
        apiKey: settings.apiKey,
        includeUsage: true,
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
      // What the watchdog watches: a tool of ours working is not the model being
      // quiet, so the silence clock is suspended for as long as one is running.
      let toolsInFlight = 0
      // Tools receive the conversation context: the folder they may work in and
      // the signal that stops a run.
      const toolContext = {
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
              throw new Error('Tool access was revoked in Settings > Chat')
            const audit = { id: randomUUID(), name: definition.name, input, status: 'running' }
            assistant.tools.push(audit)
            assistant.parts = addTool(assistant.parts, audit.id)
            emit({ type: 'tool', tool: audit })
            toolsInFlight++
            try {
              const output = await withToolBudget(
                definition.execute(input, toolContext),
                timings.toolMs,
                definition.name,
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
              toolsInFlight--
            }
          },
        })
      }
      // The step budget is the only limit on how long one reply may work, and it
      // is reported when it is what ended the reply.
      let hitStepLimit = false
      // 0 is no budget: the reply keeps working until it is done. The prompt says
      // the same, so a model is never told to stop early by a number the user did
      // not set.
      const stepGuidance = limits.maxSteps
        ? `Work in at most ${limits.maxSteps} tool steps in one reply, and end each reply with the answer written out rather than only tool calls.`
        : 'Keep working until the task is done, and end each reply with the answer written out rather than only tool calls.'
      const agent = new ToolLoopAgent({
        model,
        instructions: `${settings.systemPrompt}\nAccess level: ${settings.access}. ${thread.folder ? `Conversation folder: ${thread.folder}. File and command tools work inside it and cannot reach anything outside it.` : 'This conversation has no folder yet, so file and command tools will refuse to run until the user chooses one.'} ${stepGuidance}`,
        tools,
        stopWhen: ({ steps }) => {
          if (!limits.maxSteps) return false
          if (steps.length < limits.maxSteps) return false
          hitStepLimit = true
          return true
        },
        maxRetries: limits.maxRetries,
        // No output-token cap: a reasoning model counts its hidden thinking
        // against one, and would be cut off before it writes anything.
        // Errors are surfaced in the transcript; avoid SDK logging request bodies.
        onError: () => {},
        onStepEnd: (step) => {
          // Keep each completed step even when a subsequent call is cancelled.
          if (step.response?.messages?.length)
            response = { messages: [...(response?.messages ?? []), ...step.response.messages] }
          const input = step.usage?.inputTokens
          const output = step.usage?.outputTokens
          if (Number.isFinite(input) && input > 0) {
            assistant.context = { inputTokens: input, outputTokens: output ?? 0,
              tokens: input + (output ?? 0), estimated: false }
            emit({ type: 'context', context: assistant.context })
          }
        },
      })
      // No timeouts are handed to the provider call: the SDK's guards are blind
      // to our tools, and its first-chunk guard does not follow a retried request
      // (a server that never answers would leave the retry hanging with nothing
      // left to stop it). One clock watches the whole reply instead.
      const result = await agent.stream({
        messages: context,
        abortSignal: controller.signal,
      })
      // The stream is read one part at a time so silence can be measured while
      // waiting for the next one. Every part restarts the clock, and a tool of
      // ours working suspends it: a tool is allowed to take its own budget.
      const parts = result.stream[Symbol.asyncIterator]()
      let pending = parts.next()
      let spoke = false
      let interrupted
      for (;;) {
        const budget = spoke ? timings.chunkMs : timings.firstChunkMs
        let step
        if (budget) {
          const silence = silenceAfter(budget)
          let outcome
          try {
            outcome = await Promise.race([pending, silence.promise])
          } finally {
            silence.clear()
          }
          if (outcome === SILENCE) {
            if (toolsInFlight) continue
            // Abort the request before giving up, so a dead connection does not
            // keep a socket open behind the report.
            controller.abort()
            throw new StallError(spoke ? 'chunk' : 'first', budget)
          }
          step = outcome
        } else {
          step = await pending
        }
        if (step.done) break
        const part = step.value
        if (SPEAKING_PARTS.has(part.type)) spoke = true
        pending = parts.next()
        if (part.type === 'text-delta') {
          assistant.text += part.text
          assistant.parts = appendText(assistant.parts, part.text)
          emit({ type: 'text', text: part.text })
        }
        // Reasoning models stream their thinking before the answer. It belongs
        // in the reply's order but is never part of the answer itself.
        if (part.type === 'reasoning-delta' && part.text) {
          assistant.reasoning += part.text
          assistant.parts = appendReasoning(assistant.parts, part.text)
          emit({ type: 'reasoning', text: part.text })
        }
        if (part.type === 'error') throw part.error
        // An interrupted request ends the stream with an abort instead of an error.
        if (part.type === 'abort') interrupted = part.reason
      }
      if (interrupted !== undefined) throw interrupted
      let finishReason
      try {
        const [messages, reason] = await Promise.all([result.responseMessages, result.finishReason])
        response = { messages }
        finishReason = reason
      } catch {
        // The stream is already over; keep whatever it recorded.
      }
      if (controller.signal.aborted) assistant.status = 'stopped'
      if (!assistant.text && assistant.status !== 'stopped') {
        assistant.notice = emptyReplyNote(
          { stepLimit: hitStepLimit, truncated: finishReason === 'length' },
          limits.maxSteps,
        )
        assistant.parts = noticePart(assistant.parts, assistant.notice)
      }
    } catch (error) {
      // A stall is checked first: it aborts our own controller on the way out, so
      // it would otherwise read as the user having pressed Stop.
      const stall = stallFrom(error)
      if (stall) {
        assistant.status = 'error'
        assistant.error = stallMessage(stall)
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
      // Provider messages hang off the reply that produced them, so a branch
      // replays only its own history.
      if (response?.messages?.length) assistant.model = response.messages
      else if (assistant.text || assistant.tools.length)
        assistant.model = [
          {
            role: 'assistant',
            content: assistant.text || toolActivity(assistant.tools),
          },
        ]
      if (!assistant.context) assistant.context = {
        tokens: Math.ceil(JSON.stringify([settings.systemPrompt, ...context, ...(assistant.model ?? [])]).length / 4),
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
  async dispose() {
    const runs = [...this.active.values()]
    for (const run of runs) run.controller.abort()
    await Promise.all(runs.map((run) => run.done))
  }
}
module.exports = { ChatService, allowed }
