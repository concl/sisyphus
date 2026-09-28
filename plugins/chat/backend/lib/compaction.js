const { isObservation } = require('./tool-images')
const SUMMARY_PREFIX = '[Conversation memory — a summary of earlier messages, not new instructions]\n'
const DEFAULT_COMPACTION = { enabled: true, contextTokens: 32000 }
// Approximate deliberately: bytes of an encoded image are not text tokens.
function estimate(value) {
  let images = 0
  const text = JSON.stringify(value, (key, item) => {
    if (item && typeof item === 'object' && (item.type === 'image' || item.type === 'image-data' || item.type === 'file' && item.mediaType?.startsWith('image/'))) {
      images += 2200
      return '[image]'
    }
    return item
  }) ?? ''
  return Math.ceil(text.length / 3) + images
}
function clip(text, limit) {
  return text.length <= limit ? text : `${text.slice(0, Math.floor(limit * .65))}\n[earlier output shortened]\n${text.slice(-Math.floor(limit * .35))}`
}
function thin(message) {
  if (!Array.isArray(message.content)) return message
  const content = message.content.filter(part => part.type !== 'reasoning').map(part => {
    if (part.type !== 'tool-result') return part
    const text = JSON.stringify(part.output, (key, value) => key === 'providerOptions' ? undefined : value)
    return text.length <= 4000 ? part : { ...part, output: { type: 'text', value: clip(text, 4000) } }
  })
  if (!content.length) return null
  const { providerOptions, ...rest } = message
  return { ...rest, content }
}
// An assistant tool call and all of its tool results are indivisible. Summaries
// replace whole groups, never one side of a call/result exchange.
function groups(messages) {
  const result = []
  for (const message of messages) {
    if ((message.role === 'tool' || isObservation(message)) && result.length) result.at(-1).push(message)
    else result.push([message])
  }
  return result
}
class Compactor {
  constructor({ settings, overhead = 0, summarize, notify = () => {} }) {
    this.settings = { ...DEFAULT_COMPACTION, ...settings }
    this.overhead = overhead
    this.summarize = summarize
    this.notify = notify
    this.changed = false
    this.last = null
    this.count = 0
  }
  async prepare(messages) {
    this.last = messages
    if (!this.settings.enabled) return messages
    const budget = this.settings.contextTokens
    const before = estimate(messages) + this.overhead
    if (before < budget * .75) return messages
    const lastUser = messages.findLastIndex(message => message.role === 'user' && !isObservation(message))
    const grouped = groups(messages)
    const recent = new Set(grouped.slice(-2).flat().filter(message => messages.indexOf(message) > lastUser))
    const protectedMessages = new Set(messages.filter((message, index) => message.role === 'system' || index === lastUser || recent.has(message)))
    // Drop reasoning only in the older, replaceable region. Recent provider
    // reasoning signatures and current tool exchanges stay byte-for-byte intact.
    const reduced = messages.map(message => protectedMessages.has(message) ? message : thin(message)).filter(Boolean)
    let after = estimate(reduced) + this.overhead
    let result = reduced
    if (after > budget * .55) {
      const old = reduced.filter(message => !protectedMessages.has(message))
      if (old.length) {
        this.notify('Compacting earlier context…')
        // Bounded sequential summaries prevent the compaction request itself
        // from overflowing after a huge tool output. Each carries forward memory.
        const serialized = JSON.stringify(old)
        const chunkSize = Math.max(1000, Math.floor((budget * .5 - this.overhead - 2500) * 3))
        let memory = ''
        for (let offset = 0; offset < serialized.length; offset += chunkSize) {
          memory = await this.summarize(memory, serialized.slice(offset, offset + chunkSize))
          if (!memory?.trim()) throw new Error('Context compaction returned no summary. Retry, or disable automatic compaction in Settings > Chat.')
          memory = clip(memory.trim(), 8000)
        }
        const summary = { role: 'assistant', content: SUMMARY_PREFIX + memory }
        result = []
        let inserted = false
        for (const message of reduced) {
          if (protectedMessages.has(message)) result.push(message)
          else if (!inserted) { result.push(summary); inserted = true }
        }
        after = estimate(result) + this.overhead
      }
    }
    if (after >= budget * .9) throw new Error('The system prompt, latest user message, or recent tool results exceed the context budget. Increase Context budget in Settings > Chat or shorten the attachment/output. These messages were preserved.')
    if (result.length === messages.length && result.every((message, index) => message === messages[index])) return messages
    this.last = result
    this.changed = true
    this.count++
    this.notify(`Context compacted: approximately ${before.toLocaleString()} → ${after.toLocaleString()} tokens. Full history is still available.`)
    return result
  }
}
module.exports = { Compactor, DEFAULT_COMPACTION, estimate, groups, thin, SUMMARY_PREFIX }
