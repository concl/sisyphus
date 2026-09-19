module.exports = () => ({
  id: 'desktop.agent-tools',
  provide: ['agent.tools.v1'],
  apply(ctx) {
    const entries = new Map()
    ctx.provide('agent.tools.v1', {
      register(name, definition) {
        if (entries.has(name)) throw new Error(`Duplicate agent tool: ${name}`)
        entries.set(name, definition)
        return () => entries.delete(name)
      },
      list: () => [...entries].map(([name, definition]) => ({ name, ...definition })),
    })
  },
})
