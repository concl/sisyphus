'use strict'
const { normalizeMessages, pathTo } = require('../lib/chat-tree')

// Conversation records are UI records; harnesses receive a smaller, explicit
// branch. Attachment bytes stay beside the conversation and are read once here,
// so a harness never has to know the storage layout.
const TEXT_INLINE_LIMIT = 128 * 1024
const TEXTUAL_MIME =
  /^(text\/|application\/(json|xml|javascript|ecmascript|yaml|x-yaml|toml|sql|x-sh|x-python|x-httpd-php|graphql))|[+](json|xml)$/

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// A file the picker labels `application/octet-stream` - a `.env`, a script with
// no registered type - is still worth showing as text, so the bytes decide.
function looksTextual(bytes) {
  const sample = bytes.subarray(0, 4096)
  return !sample.includes(0) && !sample.toString('utf8').includes('\uFFFD')
}

function attachmentText(bytes, mime) {
  if (!bytes || bytes.length > TEXT_INLINE_LIMIT) return undefined
  return TEXTUAL_MIME.test(mime) || looksTextual(bytes) ? bytes.toString('utf8') : undefined
}

function userMessage(message, payloads) {
  const images = []
  const files = []
  for (const attachment of message.attachments ?? []) {
    const bytes = payloads.get(attachment.id)
    const kind = attachment.kind === 'image' ? 'image' : 'file'
    if (kind === 'image') {
      if (bytes) images.push({ data: bytes, mediaType: attachment.mime })
      continue
    }
    files.push({
      name: attachment.name,
      mime: attachment.mime,
      size: attachment.size,
      text: attachmentText(bytes, attachment.mime),
    })
  }
  return { role: 'user', text: message.text ?? '', images, files }
}

function assistantMessage(message, defaultHarness) {
  const toolCalls = (message.tools ?? []).map((tool) => {
    const call = { id: tool.id, name: tool.name, input: tool.input }
    if (tool.output !== undefined) call.output = tool.output
    if (tool.status) call.status = tool.status
    return call
  })
  const harness =
    message.model?.length || message.compactedContext?.length
      ? {
          id: message.harness ?? defaultHarness,
          ...(message.model?.length ? { transcript: message.model } : {}),
          ...(message.compactedContext?.length
            ? { compactedContext: message.compactedContext }
            : {}),
        }
      : undefined
  if (!message.text && !message.reasoning && !toolCalls.length && !harness) return null
  return {
    role: 'assistant',
    text: message.text ?? '',
    ...(message.reasoning ? { reasoning: message.reasoning } : {}),
    ...(toolCalls.length ? { toolCalls } : {}),
    ...(harness ? { harness } : {}),
  }
}

/**
 * The branch ending at `id`, normalized for a harness. User messages carry the
 * attachment payloads themselves; assistant messages carry any replay data their
 * own harness recorded, plus normalized text and tool activity every harness can
 * read.
 */
function buildHistory(messages, id, payloads, defaultHarness) {
  const history = []
  for (const message of pathTo(normalizeMessages(messages), id)) {
    if (message.role === 'user') history.push(userMessage(message, payloads))
    else {
      const assistant = assistantMessage(message, defaultHarness)
      if (assistant) history.push(assistant)
    }
  }
  return history
}

module.exports = {
  buildHistory,
  humanSize,
  attachmentText,
  TEXT_INLINE_LIMIT,
  TEXTUAL_MIME,
  looksTextual,
}
