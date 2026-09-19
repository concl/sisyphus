const { shell } = require('electron')

module.exports = () => ({
  id: 'desktop.integration.browser',
  name: 'Browser integration',
  inject: ['integrations.v1'],
  apply(ctx) {
    const integrations = ctx.get('integrations.v1')
    ctx.effect(() =>
      integrations.register('browser', {
        name: 'Default browser',
        available: () => true,
        async launch({ urls }) {
          for (const value of urls) {
            const url = new URL(value)
            if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsafe browser URL')
            await shell.openExternal(url.toString())
          }
          return { integration: 'browser', tabs: urls.length }
        },
      }),
    )
  },
})
