const { z } = require('zod')
module.exports = () => ({
  id: 'desktop.notes-tools',
  name: 'Notes tools',
  inject: ['notes.v1', 'agent.tools.v1'],
  apply(ctx) {
    const notes = ctx.get('notes.v1'),
      tools = ctx.get('agent.tools.v1')
    for (const [method, description, access, schema] of [
      [
        'list',
        'Search Markdown notes in the active vault by content or path.',
        'read',
        { query: z.string().optional() },
      ],
      [
        'read',
        'Read a Markdown note and its revision before editing it.',
        'read',
        { path: z.string() },
      ],
      [
        'create',
        'Create a Markdown note; existing files are never overwritten.',
        'write',
        { path: z.string(), content: z.string() },
      ],
      [
        'append',
        'Append Markdown text to an existing note.',
        'write',
        { path: z.string(), content: z.string() },
      ],
      [
        'save',
        'Save a note using the revision returned by read_notes; rejects stale edits.',
        'write',
        { path: z.string(), content: z.string(), revision: z.string() },
      ],
      ['daily', 'Open or create a daily Markdown note.', 'write', { date: z.string().optional() }],
    ])
      ctx.effect(() =>
        tools.register(`${method}_notes`, {
          description,
          access,
          inputSchema: z.object(schema).strict(),
          execute: (input) => notes[method](input),
        }),
      )
  },
})
