'use strict'
const { randomUUID } = require('node:crypto')

function browserTabsFlow(id = randomUUID()) {
  return {
    id,
    title: 'Open browser tabs',
    description: 'Open the websites below in your browser.',
    color: 'blue',
    inputs: [
      {
        key: 'websites',
        label: 'Websites',
        kind: 'lines',
        value: [
          'https://github.com/',
          'https://developer.mozilla.org/',
          'https://www.wikipedia.org/',
        ],
      },
    ],
    nodes: [
      {
        id: 'open-tabs',
        type: 'system.websites',
        title: 'Open websites',
        x: 320,
        y: 60,
        config: { websites: [] },
        bindings: { websites: 'websites' },
      },
    ],
    edges: [{ from: 'start', to: 'open-tabs' }],
  }
}
module.exports = { browserTabsFlow }
