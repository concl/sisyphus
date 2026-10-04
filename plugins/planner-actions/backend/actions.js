const { createSchema, validateItem } = require('../../planner/backend/lib/planner-data.js')
module.exports = () => ({
  id: 'desktop.planner-actions',
  inject: ['planner.v1', 'actions.v1'],
  apply(ctx) {
    const planner = ctx.get('planner.v1')
    ctx.effect(() =>
      ctx.get('actions.v1').registerService('calendar', {
        name: 'Calendar',
        actions: {
          createEvent: {
            name: 'Create event',
            description: 'Add an event to your calendar.',
            defaults: { event: { title: '', date: '' } },
            fields: [
              { key: 'event', label: 'Event', kind: 'json', editor: 'planner.event', expose: true },
            ],
            presentation: 'planner.item',
            outputs: [
              { key: 'id', label: 'Event ID', kind: 'text' },
              { key: 'title', label: 'Title', kind: 'text' },
              { key: 'date', label: 'Date', kind: 'text' },
            ],
            validate: ({ event }) => {
              if (!event || typeof event !== 'object' || Array.isArray(event))
                throw new Error('Enter event details')
              if (typeof event.title !== 'string' || !event.title.trim())
                throw new Error('Enter an event title')
              if (!event.date) throw new Error('Choose an event date')
              validateItem(createSchema.parse({ ...event, kind: 'event' }))
            },
            execute: ({ event }, { signal }) => {
              signal.throwIfAborted()
              return planner.createEvent(event)
            },
          },
        },
      }),
    )
  },
})
