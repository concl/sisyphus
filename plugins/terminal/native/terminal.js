const os = require('node:os')
const { detectBackendsAsync } = require('@sisyphus/native/backends')
module.exports = () => ({
  id: 'desktop.terminal',
  inject: ['transport.v1'],
  provide: ['terminal.v1'],
  apply(ctx) {
    const pty = require('node-pty')
    const transport = ctx.get('transport.v1')
    const sessions = new Map()
    let backends
    const getBackends = () => (backends ??= detectBackendsAsync())
    const size = (value, fallback) =>
      Number.isInteger(value) ? Math.max(2, Math.min(500, value)) : fallback
    const owned = (id, sender) => {
      const session = sessions.get(id)
      if (!session || session.sender !== sender) throw new Error('Unknown terminal session')
      return session
    }
    const release = (id) => {
      const session = sessions.get(id)
      if (!session) return
      sessions.delete(id)
      clearTimeout(session.timer)
      session.sender.removeListener('destroyed', session.onDestroyed)
      session.data.dispose()
      session.exit.dispose()
      session.resolve?.()
    }
    const kill = (id) => {
      const session = sessions.get(id)
      if (!session) return Promise.resolve()
      if (session.closing) return session.closing
      session.closing = new Promise((resolve) => {
        session.resolve = resolve
      })
      session.timer = setTimeout(() => release(id), 2500)
      try {
        session.pty.kill()
      } catch {
        release(id)
      }
      return session.closing
    }
    ctx.effect(() => () => Promise.all([...sessions.keys()].map(kill)))
    const handle = (name, fn) => ctx.effect(() => transport.handle(`terminal.${name}`, fn))
    handle('backends', async () => {
      const { backends, defaultId } = await getBackends()
      return { backends: backends.map(({ id, name }) => ({ id, name })), defaultId }
    })
    handle('spawn', async ({ id, backendId, cols, rows }, sender) => {
      if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid terminal id')
      if (sessions.has(id)) throw new Error('Terminal already exists')
      const backend = (await getBackends()).backends.find((item) => item.id === backendId)
      if (sessions.has(id)) throw new Error('Terminal already exists')
      if (!backend) throw new Error('Unknown shell')
      const child = pty.spawn(backend.command, backend.args, {
        name: 'xterm-256color',
        cols: size(cols, 80),
        rows: size(rows, 24),
        cwd: os.homedir(),
        // Use the packaged ConPTY implementation; its shutdown path does not
        // race an AttachConsole helper against the already-closed shell.
        useConptyDll: process.platform === 'win32',
        env: { ...process.env, TERM: 'xterm-256color' },
      })
      const onDestroyed = () => kill(id)
      const data = child.onData((data) => transport.send(sender, 'terminal.data', { id, data }))
      const exit = child.onExit(({ exitCode }) => {
        transport.send(sender, 'terminal.exit', { id, exitCode })
        release(id)
      })
      sessions.set(id, { pty: child, sender, onDestroyed, data, exit })
      sender.once('destroyed', onDestroyed)
      return { pid: child.pid }
    })
    handle('write', ({ id, data }, sender) => {
      if (typeof data !== 'string' || data.length > 65536) throw new Error('Invalid terminal input')
      owned(id, sender).pty.write(data)
    })
    handle('resize', ({ id, cols, rows }, sender) =>
      owned(id, sender).pty.resize(size(cols, 80), size(rows, 24)),
    )
    handle('kill', ({ id }, sender) => {
      if (sessions.has(id)) {
        owned(id, sender)
        return kill(id)
      }
    })
    ctx.provide('terminal.v1', { count: () => sessions.size })
  },
})
