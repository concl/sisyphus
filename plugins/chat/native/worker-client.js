const { z } = require('zod')
const path = require('node:path')

// Electron owns keys, dialogs, and tool capabilities. Model and history work runs
// in a worker, communicating only through requests, stream events, and tool RPC.
class WorkerChat {
  constructor({ workers, directory, registry, config }) {
    this.pending = new Map()
    this.tools = new Map()
    this.next = 0
    this.closed = false
    this.worker = workers.create(path.join(__dirname, 'worker.js')).then(worker => {
      worker.on('message', message => this.receive(message))
      worker.on('error', error => this.fail(error))
      worker.on('exit', code => this.fail(new Error(`Chat worker stopped (${code})`)))
      worker.postMessage({ type: 'init', directory })
      return worker
    })
    this.registry = registry
    this.config = config
  }
  fail(error) {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    for (const tool of this.tools.values()) tool.abort()
    this.tools.clear()
  }
  async receive(message) {
    if (message.type === 'tool-cancel') return this.tools.get(message.id)?.abort()
    if (message.type === 'tool') {
      const controller = new AbortController()
      this.tools.set(message.id, controller)
      const worker = await this.worker
      try {
        const definition = this.registry.list().find(tool => tool.name === message.name)
        const access = this.config.get().access
        if (!definition || !(access === 'write' || (access === 'read' && definition.access === 'read')))
          throw new Error('Tool unavailable or access revoked')
        const value = await definition.execute(message.input, { ...message.context, signal: controller.signal })
        worker.postMessage({ type: 'tool-result', id: message.id, value })
      } catch (error) {
        worker.postMessage({ type: 'tool-result', id: message.id, error: String(error.message ?? error) })
      } finally { this.tools.delete(message.id) }
      return
    }
    const pending = this.pending.get(message.id)
    if (!pending) return
    if (message.type === 'event') return pending.emit?.(message.event)
    this.pending.delete(message.id)
    if (message.error) pending.reject(new Error(message.error))
    else pending.resolve(message.value)
  }
  async call(method, args, emit) {
    if (this.closed) throw new Error('Chat plugin is stopped')
    const worker = await this.worker
    const id = ++this.next
    let settings, definitions
    if (method === 'send' || method === 'edit') {
      settings = this.config.resolve()
      definitions = this.registry.list().map(({ name, description, access, inputSchema }) =>
        ({ name, description, access, schema: z.toJSONSchema(inputSchema) }))
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, emit })
      worker.postMessage({ type: 'call', id, method, args, settings, definitions })
    })
  }
  list() { return this.call('list', []) }
  get(id) { return this.call('get', [id]) }
  delete(id) { return this.call('delete', [id]) }
  setFolder(id, folder) { return this.call('setFolder', [id, folder]) }
  selectBranch(input) { return this.call('selectBranch', [input]) }
  cancel(id, owner) { return this.call('cancel', [id, owner]).catch(() => {}) }
  send(input, owner, emit) { return this.call('send', [input, owner], emit) }
  edit(input, owner, emit) { return this.call('edit', [input, owner], emit) }
  async dispose() {
    const worker = await this.worker
    try {
      await Promise.race([this.call('dispose', []), new Promise(resolve => setTimeout(resolve, 3000))])
    } finally {
      this.closed = true
      this.fail(new Error('Chat plugin reloaded'))
      await worker.terminate()
    }
  }
}
module.exports = { WorkerChat }
