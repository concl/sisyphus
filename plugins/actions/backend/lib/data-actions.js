'use strict'
function dataActions() {
  return {
    value: {
      name: 'Value',
      description: 'Build reusable data for the following steps.',
      effects: ['None. Returns data without changing files or application state.'],
      calls: ['data-actions.v1.value(input)'],
      notes: [
        'Accepts any JSON value. Connect the Value output to a later input; use a property path to select part of it.',
      ],
      examples: [
        {
          title: 'A reusable object',
          input: { value: { name: 'Ada', count: 3 } },
          output: { value: { name: 'Ada', count: 3 } },
        },
      ],
      icon: '{}',
      defaults: { value: {} },
      fields: [{ key: 'value', label: 'Value', kind: 'json' }],
      outputs: [{ key: 'value', label: 'Value', kind: 'json' }],
      execute: ({ value }) => ({ value }),
    },
    parse: {
      name: 'Read JSON',
      description: 'Turn text from a script or service into structured data.',
      effects: ['None. Parses text in memory.'],
      calls: ['data-actions.v1.parse(input) → JSON.parse(text)'],
      notes: [
        'Connect Run program → Output or Web request → Response text to JSON text. Invalid JSON fails this step and skips its dependents.',
      ],
      examples: [
        {
          title: 'Read a script response',
          input: { text: '{"ready":true}' },
          output: { value: { ready: true } },
        },
      ],
      icon: '{}',
      defaults: { text: '{}' },
      fields: [
        {
          key: 'text',
          label: 'JSON text',
          kind: 'text',
          required: true,
          hint: 'A JSON document as text, often from a previous step’s output.',
        },
      ],
      outputs: [{ key: 'value', label: 'Data', kind: 'json' }],
      validate: (input) => {
        if (typeof input.text !== 'string') throw new Error('JSON text must be text')
      },
      execute: ({ text }) => ({ value: JSON.parse(text) }),
    },
    format: {
      name: 'Format text',
      description: 'Make a path, address, message, or argument using data.',
      effects: ['None. Produces text; does not open addresses or run commands.'],
      calls: ['data-actions.v1.format(input)'],
      notes: [
        'Placeholders use property paths, not JavaScript. Missing properties fail the step. Objects and lists are inserted as JSON text.',
      ],
      examples: [
        {
          title: 'Build a greeting',
          input: { template: 'Hello {{person.name}}', values: { person: { name: 'Ada' } } },
          output: { text: 'Hello Ada' },
        },
      ],
      icon: 'Aa',
      defaults: { template: '', values: {} },
      fields: [
        {
          key: 'template',
          label: 'Template',
          kind: 'text',
          hint: 'Use {{name}} or {{person.name}} to insert a value.',
        },
        { key: 'values', label: 'Values', kind: 'json' },
      ],
      outputs: [{ key: 'text', label: 'Text', kind: 'text' }],
      validate(input) {
        if (typeof input.template !== 'string' || !input.values || typeof input.values !== 'object')
          throw new Error('Use a text template and an object of values')
      },
      execute: ({ template, values }) => ({
        text: template.replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/g, (_, path) => {
          let value = values
          for (const key of path.split('.')) {
            if (
              ['__proto__', 'prototype', 'constructor'].includes(key) ||
              !value ||
              typeof value !== 'object' ||
              !Object.hasOwn(value, key)
            )
              throw new Error(`Template value unavailable: ${path}`)
            value = value[key]
          }
          return typeof value === 'object' ? JSON.stringify(value) : String(value)
        }),
      }),
    },
  }
}
module.exports = { dataActions }
