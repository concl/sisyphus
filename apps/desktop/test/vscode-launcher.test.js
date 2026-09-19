'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { workspaceDocument } = require('../../../plugins/contexts/native/lib/vscode-launcher.js')

test('generated VS Code workspaces preserve multi-root folder identity', () => {
  const folders = [path.resolve('client'), path.resolve('server')]
  assert.deepEqual(workspaceDocument(folders), {
    folders: [
      { name: 'client', path: folders[0] },
      { name: 'server', path: folders[1] },
    ],
    settings: {},
    extensions: { recommendations: [] },
  })
})
