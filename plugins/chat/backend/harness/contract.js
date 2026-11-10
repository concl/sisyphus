'use strict'
// The agent-harness contract.
//
// Chat owns conversations, attachments, tool permissions, cancellation, and the
// UI event stream. A harness owns the model loop: it turns the normalized
// conversation below into provider calls, executes the tools it is given, and
// streams text, reasoning, and usage back. Swapping harnesses therefore means
// adding a module that implements this interface, not rewriting ChatService.
//
// The shapes are plain data so they survive the worker boundary and a struct
// cloned history file. Provider-specific request/response objects never enter
// this contract; a harness may keep its own replay data in `harness.transcript`
// (opaque to Chat) and its own compacted context in `harness.compactedContext`.

/** The harness shipped with the app. Stored as the default selection. */
const DEFAULT_HARNESS = 'vercel-ai'
const HARNESS_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/

/**
 * One message in the branch a reply continues.
 *
 * @typedef {Object} HarnessUserMessage
 * @property {'user'} role
 * @property {string} text The words the user wrote, without attachment bodies.
 * @property {Array<{ data: Buffer, mediaType: string }>} images Image payloads to send as image content.
 * @property {Array<{ name: string, mime: string, size: number, text?: string }>} files
 *   Non-image attachments. `text` is present when the app could read the file as
 *   text within its inline limit; otherwise the harness should describe it by name,
 *   type, and size.
 */

/**
 * @typedef {Object} HarnessToolCall
 * @property {string} id Stable id, also used to pair the result with this call.
 * @property {string} name
 * @property {unknown} input
 * @property {unknown} [output] The raw tool result, when one was recorded.
 * @property {'running'|'complete'|'failed'} [status]
 */

/**
 * @typedef {Object} HarnessAssistantMessage
 * @property {'assistant'} role
 * @property {string} text The answer written so far (not reasoning, not notices).
 * @property {string} [reasoning]
 * @property {HarnessToolCall[]} [toolCalls]
 * @property {{ id: string, transcript?: unknown[], compactedContext?: unknown[] }} [harness]
 *   Replay data recorded by the harness that produced this message. A harness must
 *   use it only when `id` matches its own id; another harness should fall back to
 *   the normalized fields above.
 */

/** @typedef {HarnessUserMessage | HarnessAssistantMessage} HarnessMessage */

/**
 * A tool the harness may call. Chat has already checked current access and wraps
 * `execute` with auditing, the per-call budget, and cancellation, so a harness
 * only has to call it and feed the result back to the model.
 *
 * @typedef {Object} HarnessTool
 * @property {string} name
 * @property {string} description
 * @property {object} parameters JSON Schema for the tool arguments.
 * @property {'read'|'write'} access
 * @property {(input: unknown, context: { signal: AbortSignal }) => Promise<unknown>} execute
 */

/**
 * @typedef {Object} HarnessRequest
 * @property {string} runId
 * @property {string} conversationId
 * @property {string|null} folder
 * @property {{ id: string, baseURL: string, model: string, apiKey?: string }} provider
 * @property {string} systemPrompt
 * @property {'none'|'read'|'write'} access
 * @property {{ maxSteps: number, maxRetries: number }} limits
 * @property {{ enabled: boolean, contextTokens: number }} compaction
 * @property {HarnessMessage[]} messages The branch this reply continues, oldest first,
 *   ending with the user message being answered.
 * @property {HarnessTool[]} tools Only tools allowed by the current access level.
 */

/**
 * Streamed output. Chat persists text/reasoning, draws notices as its own words,
 * and stores context usage without treating it as model output.
 *
 * @typedef {{ type: 'text', text: string }
 *   | { type: 'reasoning', text: string }
 *   | { type: 'notice', text: string }
 *   | { type: 'context', context: import('../../../../shared/sdk/src/index').ChatContext }} HarnessEvent
 */

/**
 * @typedef {Object} HarnessResult
 * @property {unknown[]} [transcript] Provider messages that replay this reply
 *   exactly. Stored with the assistant message and offered back to this harness
 *   on the next turn.
 * @property {unknown[]} [compactedContext] The context checkpoint after automatic
 *   compaction, if the harness compacted. Opaque to Chat.
 * @property {string} [finishReason] The provider's finish reason, when known.
 * @property {boolean} [stepLimitHit] True when the step budget ended the reply.
 */

/**
 * @typedef {Object} HarnessControl
 * @property {AbortSignal} signal Aborted when the user stops the reply, the
 *   conversation is disposed, or the silence watchdog fires. A harness must pass
 *   it to provider requests and stop promptly.
 * @property {(event: HarnessEvent) => void} emit
 * @property {() => void} beginWork Mark non-model work (compaction, preparation)
 *   so a quiet provider stream is not reported as a stall.
 * @property {() => void} endWork
 */

/**
 * @typedef {Object} Harness
 * @property {string} id Stable id persisted as the selection.
 * @property {string} name Shown in Settings > Chat.
 * @property {string} [description]
 * @property {(request: HarnessRequest, control: HarnessControl) => Promise<HarnessResult>} run
 */

function assertHarness(harness) {
  if (!harness || typeof harness !== 'object') throw new Error('A harness must be an object.')
  if (typeof harness.id !== 'string' || !HARNESS_ID.test(harness.id))
    throw new Error('A harness needs a lowercase id of letters, digits, dots, dashes, or underscores.')
  if (typeof harness.name !== 'string' || !harness.name.trim())
    throw new Error(`Harness ${harness.id} needs a name.`)
  if (typeof harness.run !== 'function') throw new Error(`Harness ${harness.id} needs a run function.`)
  return harness
}

module.exports = { DEFAULT_HARNESS, HARNESS_ID, assertHarness }
