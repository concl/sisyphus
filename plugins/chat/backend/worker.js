const { parentPort } = require('node:worker_threads')
const { ChatService } = require('./lib/chat-service')
const { ChatHistory } = require('./lib/chat-history')
let chat, settings, definitions = [], next = 0
const pending = new Map()

parentPort.on('message', async message => {
  if (message.type === 'init') {
    chat = new ChatService({ history: new ChatHistory(message.directory),
      config: { resolve: () => settings, get: () => settings }, registry: { list: () => definitions } })
    return
  }
  if (message.type === 'tool-result') {
    const call = pending.get(message.id)
    if (!call) return
    pending.delete(message.id)
    call.cleanup()
    if (message.error) call.reject(new Error(message.error))
    else call.resolve(message.value)
    return
  }
  if (message.type !== 'call') return
  try {
    if (message.settings) {
      const { jsonSchema } = await import('ai')
      settings = message.settings
      definitions = message.definitions.map(definition => ({ ...definition,
        inputSchema: jsonSchema(definition.schema),
        execute: (input, { signal, ...context }) => new Promise((resolve, reject) => {
          const id = ++next
          const cancel = () => {
            pending.delete(id)
            parentPort.postMessage({ type: 'tool-cancel', id })
            reject(new Error('Request stopped'))
          }
          if (signal.aborted) return reject(new Error('Request stopped'))
          signal.addEventListener('abort', cancel, { once: true })
          pending.set(id, { resolve, reject, cleanup: () => signal.removeEventListener('abort', cancel) })
          parentPort.postMessage({ type: 'tool', id, name: definition.name, input, context })
        }),
      }))
    }
    const value = await chat[message.method](...message.args,
      event => parentPort.postMessage({ type: 'event', id: message.id, event }))
    parentPort.postMessage({ type: 'result', id: message.id, value })
  } catch (error) {
    parentPort.postMessage({ type: 'result', id: message.id, error: String(error.message ?? error) })
  }
})
