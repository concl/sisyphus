const { dataActions } = require('./lib/data-actions.js')
module.exports = () => ({
  id: 'desktop.data-actions',
  name: 'Data actions',
  inject: ['actions.v1'],
  provide: ['data-actions.v1'],
  apply(ctx) {
    const actions = dataActions()
    const service = Object.fromEntries(
      Object.entries(actions).map(([id, action]) => [
        id,
        (input) => {
          action.validate?.(input)
          return action.execute(input)
        },
      ]),
    )
    ctx.provide('data-actions.v1', service)
    ctx.effect(() =>
      ctx.get('actions.v1').registerService('data', {
        name: 'Data',
        actions: Object.fromEntries(
          Object.entries(actions).map(([id, action]) => [id, { ...action, execute: service[id] }]),
        ),
      }),
    )
  },
})
