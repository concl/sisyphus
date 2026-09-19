const { BrowserWindow } = require('electron')
const { z } = require('zod')
const { PlannerRepository, createSchema, updateSchema, idSchema } = require('../lib/planner-data')

module.exports = () => ({
  id: 'desktop.planner-data',
  inject: ['storage.v1', 'transport.v1', 'agent.tools.v1'],
  provide: ['planner.v1'],
  apply(ctx) {
    const transport = ctx.get('transport.v1')
    const repository = new PlannerRepository(ctx.get('storage.v1'), (document) => {
      for (const window of BrowserWindow.getAllWindows())
        transport.send(window.webContents, 'planner.changed', document)
    })
    ctx.provide('planner.v1', repository)
    const tools = ctx.get('agent.tools.v1')
    const definitions = [
      [
        'list_planner',
        'Read current to-dos and calendar events, including their IDs.',
        'read',
        z.object({}).strict(),
        () => repository.list(),
      ],
      [
        'create_planner_item',
        'Create a to-do or dated calendar event. Events require a YYYY-MM-DD date.',
        'write',
        createSchema,
        (input) => repository.create(input),
      ],
      [
        'update_planner_item',
        'Edit a title/date or complete/reopen a to-do. Read the item ID first.',
        'write',
        updateSchema,
        (input) => repository.update(input),
      ],
      [
        'delete_planner_item',
        'Delete a planner item by ID, retaining its sync tombstone.',
        'write',
        idSchema,
        (input) => repository.remove(input),
      ],
    ]
    for (const [name, description, access, inputSchema, execute] of definitions)
      ctx.effect(() => tools.register(name, { description, access, inputSchema, execute }))
    ctx.effect(() => transport.handle('planner.get', () => repository.document()))
    for (const method of ['create', 'update', 'remove'])
      ctx.effect(() => transport.handle(`planner.${method}`, (input) => repository[method](input)))
  },
})
