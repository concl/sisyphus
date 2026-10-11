const { shell } = require('electron')
const { localActions } = require('./lib/action-runners.js')

module.exports = () => ({
  id: 'desktop.local-actions',
  name: 'Computer actions',
  inject: ['actions.v1', 'integrations.v1'],
  provide: ['system-actions.v1'],
  apply(ctx) {
    const definitions = localActions({ shell, integrations: ctx.get('integrations.v1') })
    delete definitions.run // Execution belongs to scripts.v1; keep legacy IDs as aliases there.
    const service = Object.fromEntries(
      Object.entries(definitions).map(([id, action]) => [
        id,
        (input, context) => {
          action.validate(input)
          return action.execute(
            input,
            context ?? {
              signal: new AbortController().signal,
              log() {},
              flow: { id: 'service' },
              node: { id },
            },
          )
        },
      ]),
    )
    ctx.provide('system-actions.v1', service)
    ctx.effect(() =>
      ctx.get('actions.v1').registerService('system', {
        name: 'This computer',
        actions: Object.fromEntries(
          Object.entries(definitions).map(([id, action]) => [
            id,
            {
              ...action,
              aliases: [id],
              execute: service[id],
            },
          ]),
        ),
      }),
    )
  },
})
