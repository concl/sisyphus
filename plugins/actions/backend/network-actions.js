const { networkActions } = require('./lib/network-actions.js')

module.exports = () => ({
  id: 'desktop.network-actions',
  name: 'Web actions',
  inject: ['actions.v1'],
  provide: ['network-actions.v1'],
  apply(ctx) {
    const definitions = networkActions()
    const service = {
      request(input, context = { signal: new AbortController().signal, log() {} }) {
        definitions.request.validate(input)
        return definitions.request.execute(input, context)
      },
    }
    ctx.provide('network-actions.v1', service)
    ctx.effect(() =>
      ctx.get('actions.v1').registerService('web', {
        name: 'Web',
        actions: { request: { ...definitions.request, execute: service.request } },
      }),
    )
  },
})
