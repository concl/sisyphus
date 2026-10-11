const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { Vault, notePath } = require('../../../plugins/notes/backend/vault.js')
const { ActionServices } = require('../../../plugins/actions/backend/lib/catalog.js')

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sisyphus-notes-'))
  const vault = new Vault(directory)
  await vault.ready
  await vault.createProject({ parent: directory, name: 'notes' })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  return { vault, directory }
}
test('a new installation waits for an explicit folder and keeps recent projects', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sisyphus-projects-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const vault = new Vault(directory)
  assert.equal((await vault.list()).folder, '')
  await assert.rejects(vault.create({ path: 'No project', content: '' }), /project folder first/)
  await vault.createProject({ parent: directory, name: 'First' })
  await vault.createFolder({ path: 'Empty/Nested' })
  assert.deepEqual((await vault.list()).folders, ['Empty', 'Empty/Nested'])
  await vault.createProject({ parent: directory, name: 'Second' })
  const first = path.join(directory, 'First')
  await vault.setFolder(first)
  assert.equal((await new Vault(directory).list()).projects.length, 2)
  await assert.rejects(vault.createProject({ parent: directory, name: 'First' }), {
    code: 'EEXIST',
  })
  await assert.rejects(
    vault.createProject({ parent: directory, name: '../escape' }),
    /relative path/,
  )
  await assert.rejects(vault.setFolder(path.join(directory, 'missing')), { code: 'ENOENT' })
  assert.equal(vault.folder, await fs.realpath(first))
})
test('legacy default notes are retained without creating a new implicit project', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sisyphus-legacy-notes-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  await fs.mkdir(path.join(directory, 'notes'))
  await fs.writeFile(path.join(directory, 'notes', 'Existing.md'), 'Keep this')
  const vault = new Vault(directory)
  assert.equal((await vault.list()).notes[0].path, 'Existing.md')
})
test('Markdown notes persist as ordinary files and search includes content, tags, and nested paths', async (t) => {
  const { vault, directory } = await fixture(t)
  const note = await vault.create({
    path: 'Projects/Idea',
    content: '# Idea\n\nA telescope #science [[Sky|night]]\n`[[not a link]]`',
  })
  assert.equal(
    await fs.readFile(path.join(directory, 'notes/Projects/Idea.md'), 'utf8'),
    note.content,
  )
  assert.deepEqual(note.tags, ['science'])
  assert.deepEqual(note.links, ['Sky'])
  assert.equal((await vault.list({ query: 'TELESCOPE' })).notes[0].path, note.path)
  assert.equal((await new Vault(directory).read({ path: note.path })).content, note.content)
  await assert.rejects(vault.create({ path: note.path, content: 'overwrite' }), { code: 'EEXIST' })
})
test('save rejects stale revisions and concurrent appends preserve both updates', async (t) => {
  const { vault } = await fixture(t)
  const initial = await vault.create({ path: 'Note', content: 'one' })
  const second = await vault.save({ path: 'Note', content: 'two', revision: initial.revision })
  await assert.rejects(
    vault.save({ path: 'Note', content: 'lost', revision: initial.revision }),
    /changed on disk/,
  )
  await Promise.all([
    vault.append({ path: 'Note', content: '\nthree' }),
    vault.append({ path: 'Note', content: '\nfour' }),
  ])
  assert.equal((await vault.read({ path: 'Note' })).content, 'two\nthree\nfour')
  await fs.writeFile(path.join(vault.folder, 'Note.md'), 'external')
  await assert.rejects(
    vault.save({ path: 'Note', content: 'lost', revision: second.revision }),
    /changed on disk/,
  )
  assert.equal((await vault.read({ path: 'Note' })).content, 'external')
})
test('paths cannot escape the vault and symlink folders cannot be traversed', async (t) => {
  const { vault, directory } = await fixture(t)
  for (const name of [
    '../escape',
    '/escape',
    'C:\\escape',
    'a/../escape',
    '.hidden/file',
    'NUL',
    'a:b',
    'a//b',
  ])
    assert.throws(() => notePath(name))
  const outside = path.join(directory, 'outside')
  await fs.mkdir(outside)
  await fs.symlink(outside, path.join(vault.folder, 'linked'), 'junction')
  await assert.rejects(vault.create({ path: 'linked/escape', content: 'no' }), /Symbolic links/)
  assert.deepEqual((await vault.list()).notes, [])
})
test('rename never clobbers notes; trash retains the Markdown content for recovery', async (t) => {
  const { vault } = await fixture(t)
  const first = await vault.create({ path: 'First', content: 'keep me' })
  await vault.create({ path: 'Second', content: 'also keep me' })
  await assert.rejects(
    vault.rename({ path: first.path, newPath: 'Second', revision: first.revision }),
    { code: 'EEXIST' },
  )
  const moved = await vault.rename({
    path: first.path,
    newPath: 'Folder/Moved',
    revision: first.revision,
  })
  assert.equal(moved.content, first.content)
  const trashed = await vault.trash({ path: moved.path, revision: moved.revision })
  assert.equal(await fs.readFile(trashed.trashPath, 'utf8'), first.content)
  assert.deepEqual(
    (await vault.list()).notes.map((note) => note.path),
    ['Second.md'],
  )
})
test('daily notes reuse existing files and reject invalid dates', async (t) => {
  const { vault } = await fixture(t)
  const first = await vault.daily({ date: '2026-10-08' })
  await vault.append({ path: first.path, content: 'Today’s thought' })
  assert.match((await vault.daily({ date: '2026-10-08' })).content, /Today’s thought/)
  await assert.rejects(vault.daily({ date: '2026-02-31' }), /valid/)
})
test('opening a vault uses existing Markdown and survives a new service lifetime', async (t) => {
  const { vault, directory } = await fixture(t)
  const existing = path.join(directory, 'existing')
  await fs.mkdir(existing)
  await fs.writeFile(path.join(existing, 'Existing.md'), '# Existing')
  await fs.mkdir(path.join(existing, '.obsidian'))
  await fs.writeFile(path.join(existing, '.obsidian', 'hidden.md'), 'hidden')
  await vault.setFolder(existing)
  const reopened = new Vault(directory)
  assert.deepEqual(
    (await reopened.list()).notes.map((note) => note.path),
    ['Existing.md'],
  )
  assert.equal(reopened.folder, await fs.realpath(existing))
})
test('Notes actions are discoverable, executable through the services catalog, and disposable', async (t) => {
  const { vault } = await fixture(t)
  const actions = new ActionServices(),
    disposers = []
  require('../../../plugins/notes/backend/actions.js')().apply({
    get: (name) => (name === 'notes.v1' ? vault : actions),
    effect: (work) => disposers.push(work()),
  })
  assert.equal(actions.list().length, 5)
  assert.ok(
    actions
      .list()
      .every(
        (action) => action.service.id === 'notes' && action.effects.length && action.calls.length,
      ),
  )
  const note = await actions.invoke('notes.create', { path: 'Workflow', content: '# Automated\n' })
  await actions.invoke('notes.append', { path: note.path, content: 'From a workflow' })
  assert.match((await actions.invoke('notes.read', { path: note.path })).content, /From a workflow/)
  assert.equal((await actions.invoke('notes.list', { query: 'automated' })).notes.length, 1)
  disposers.reverse().forEach((dispose) => dispose())
  assert.equal(actions.list().length, 0)
})
