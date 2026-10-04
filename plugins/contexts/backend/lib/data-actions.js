'use strict'
function dataActions() {
  return {
    value: {
      name: 'Value',
      description: 'Build reusable data for the following steps.',
      icon: '{}',
      defaults: { value: {} },
      fields: [{ key: 'value', label: 'Value', kind: 'json' }],
      outputs: [{ key: 'value', label: 'Value', kind: 'json' }],
      execute: ({ value }) => ({ value }),
    },
    parse: {
      name: 'Read JSON',
      description: 'Turn text from a script or service into structured data.',
      icon: '{}',
      defaults: { text: '{}' },
      fields: [{ key: 'text', label: 'JSON text', kind: 'text' }],
      outputs: [{ key: 'value', label: 'Data', kind: 'json' }],
      validate: (input) => {
        if (typeof input.text !== 'string') throw new Error('JSON text must be text')
      },
      execute: ({ text }) => ({ value: JSON.parse(text) }),
    },
    format: {
      name: 'Format text',
      description: 'Make a path, address, message, or argument using data.',
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
