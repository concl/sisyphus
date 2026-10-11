module.exports = () => ({
  id: 'desktop.integrations',
  provide: ['integrations.v1'],
  apply(ctx) {
    const entries = new Map()
    ctx.provide('integrations.v1', {
      register(id, integration) {
        if (entries.has(id)) throw new Error(`Duplicate integration: ${id}`)
        entries.set(id, integration)
        return () => entries.delete(id)
      },
      list() {
        return [...entries].map(([id, integration]) => ({
          id,
          name: integration.name,
          available: integration.available(),
        }))
      },
      launch(id, input) {
        const integration = entries.get(id)
        if (!integration) throw new Error(`Integration unavailable: ${id}`)
        return integration.launch(input)
      },
    })
  },
})
