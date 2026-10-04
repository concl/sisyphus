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
            effects: [
              'Creates a new event in the Sisyphus calendar. Running again creates another event. Stop does not delete an event already created.',
            ],
            calls: ['planner.v1.createEvent(event) → saves the event and notifies calendar views'],
            notes: [
              'Requires a title and a date. Use the Event editor for dates, times, and recurrence, or supply an event object from an earlier step.',
            ],
            examples: [
              {
                title: 'Create an all-day event',
                input: { event: { title: 'Project review', date: '2026-11-02' } },
              },
            ],
            defaults: { event: { title: '', date: '' } },
            fields: [
              {
                key: 'event',
                label: 'Event',
                kind: 'json',
                editor: 'planner.event',
                expose: true,
                required: true,
                hint: 'An event object with title and date (YYYY-MM-DD), plus optional scheduling details.',
              },
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
