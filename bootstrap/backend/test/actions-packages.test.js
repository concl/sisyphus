const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { packages, compile } = require('../lib/plugin-compiler')
const root = path.resolve(__dirname, '../../..')

// Compile each package without any neighboring plugin source. Type-only imports
// are checked separately by the frontend TypeScript check.
for (const [name, ids] of Object.entries({
  planner: [
    'desktop.planner-actions',
    'desktop.planner-data',
    'desktop.planner-sync',
    'feature.planner',
    'feature.planner-actions',
  ],
  actions: [
    'desktop.action-catalog',
    'desktop.automations',
    'desktop.data-actions',
    'desktop.local-actions',
    'desktop.network-actions',
    'feature.action-catalog',
    'feature.contexts',
  ],
  integrations: [
    'desktop.app-contexts',
    'desktop.integration.browser',
    'desktop.integration.vscode',
    'desktop.integrations',
  ],
})) {
  test(name + ' compiles independently and preserves its plugin IDs', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'actions-package-'))
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
    fs.cpSync(path.join(root, 'plugins', name), path.join(directory, name), {
      recursive: true,
      filter: (file) => !file.split(path.sep).includes('node_modules'),
    })
    const entries = packages(directory)
    assert.deepEqual(entries.map((entry) => entry.id).sort(), ids)
    for (const entry of entries) {
      assert.equal(entry.error, undefined)
      const built = await compile(entry)
      assert.ok(built.source.length)
      if (entry.id === 'feature.contexts') {
        assert.match(built.source, /id: "contexts"/)
      }
    }
  })
}

test('Calendar frontend remains independent of Actions', async () => {
  const entry = packages(path.join(root, 'plugins')).find((entry) => entry.id === 'feature.planner')
  const built = await compile(entry)
  assert.doesNotMatch(built.source, /ui\.actions\.v1|actions\.v1/)
})
