const pathField = {
  key: 'path',
  label: 'Note path',
  kind: 'text',
  required: true,
  expose: true,
  hint: 'Relative to the current project folder, for example Projects/Ideas.md.',
}
const contentField = {
  key: 'content',
  label: 'Markdown',
  kind: 'text',
  expose: true,
  hint: 'Plain Markdown text. Include any desired newlines.',
}
module.exports = () => ({
  id: 'desktop.notes-actions',
  name: 'Notes actions',
  inject: ['notes.v1', 'actions.v1'],
  apply(ctx) {
    const notes = ctx.get('notes.v1')
    const noteOutputs = [
      { key: 'path', label: 'Note path', kind: 'text' },
      { key: 'content', label: 'Markdown', kind: 'text' },
      { key: 'revision', label: 'Revision', kind: 'text' },
    ]
    const definitions = {
      list: [
        'Search notes',
        'Find notes by path or Markdown content in the current project.',
        { query: '' },
        [{ key: 'query', label: 'Search text', kind: 'text', expose: true }],
        [
          { key: 'notes', label: 'Matching notes', kind: 'json' },
          { key: 'folder', label: 'Project folder', kind: 'text' },
          { key: 'warnings', label: 'Unreadable files', kind: 'json' },
        ],
        false,
      ],
      read: [
        'Read note',
        'Read a Markdown file from the current project.',
        { path: '' },
        [pathField],
        noteOutputs,
        false,
      ],
      create: [
        'Create note',
        'Create a new Markdown note, making parent folders as needed.',
        { path: '', content: '' },
        [pathField, contentField],
        noteOutputs,
        true,
      ],
      append: [
        'Append to note',
        'Append Markdown to an existing note.',
        { path: '', content: '\n' },
        [pathField, contentField],
        noteOutputs,
        true,
      ],
      daily: [
        'Daily note',
        'Open or create a daily note in the Daily folder.',
        { date: '' },
        [
          {
            key: 'date',
            label: 'Date',
            kind: 'text',
            hint: 'YYYY-MM-DD; empty uses today in the computer’s local timezone.',
          },
        ],
        noteOutputs,
        true,
      ],
    }
    const actions = Object.fromEntries(
      Object.entries(definitions).map(
        ([method, [name, description, defaults, fields, outputs, writes]]) => [
          method,
          {
            name,
            description,
            defaults,
            fields,
            outputs,
            effects: [
              writes
                ? 'Writes Markdown in the active project. Stop cannot undo a completed write.'
                : 'Reads the active project without changing files.',
            ],
            calls: [`notes.v1.${method}(input)`],
            notes: [
              'Uses the project selected in Notes. Open or create a project folder before writing. Hidden folders and symbolic links are excluded.',
              ...(method === 'create'
                ? ['Fails if the path already exists; never overwrites a note.']
                : []),
              ...(method === 'append' ? ['Running again appends the text again.'] : []),
            ],
            examples: [
              {
                title: name,
                input:
                  method === 'daily'
                    ? {}
                    : method === 'list'
                      ? { query: 'meeting' }
                      : {
                          path: 'Projects/Ideas.md',
                          ...(writes ? { content: '\nA new idea.\n' } : {}),
                        },
              },
            ],
            validate(input) {
              if (fields.includes(pathField)) require('./vault.js').notePath(input.path)
              if (fields.includes(contentField) && typeof input.content !== 'string')
                throw new Error('Markdown must be text')
            },
            execute: (input, { signal }) => {
              signal?.throwIfAborted()
              return notes[method](input)
            },
          },
        ],
      ),
    )
    ctx.effect(() => ctx.get('actions.v1').registerService('notes', { name: 'Notes', actions }))
  },
})
