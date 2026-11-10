const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const {
  authorize,
  desktopClient,
  googleCalendar,
} = require('../../../plugins/planner/backend/lib/google-calendar')
const { syncGoogle } = require('../../../plugins/planner/backend/lib/google-sync')
const { registerGoogleSync } = require('../../../plugins/planner/backend/lib/google-connection')
const { PlannerRepository } = require('../../../plugins/planner/backend/lib/planner-data')

const signal = new AbortController().signal
const client = {
  client_id: 'test.apps.googleusercontent.com',
  client_secret: 'test-secret',
}
const allDay = (id, summary, extra) => ({
  id,
  etag: '"1"',
  summary,
  start: { date: '2026-11-10' },
  end: { date: '2026-11-12' },
  ...extra,
})

function fixture(entries = []) {
  const data = new Map()
  const planner = new PlannerRepository({
    get: (scope, key) => structuredClone(data.get(`${scope}:${key}`)),
    set: (scope, key, value) => data.set(`${scope}:${key}`, structuredClone(value)),
  })
  const calendarId = planner.saveCalendar({ name: 'Google', color: '#4285f4' }).id
  const remote = new Map(entries.map((entry) => [entry.id, entry]))
  const calls = []
  let state = { binding: { localId: calendarId, remoteId: 'remote' }, links: [] }
  let etag = 1
  const api = {
    events: async () => [...remote.values()],
    async write(calendar, operation) {
      assert.equal(calendar, 'remote')
      calls.push(operation)
      const { id, method, body } = operation
      if (method !== 'POST') assert.equal(operation.etag, remote.get(id).etag)
      if (method === 'DELETE') remote.delete(id)
      else remote.set(id, { ...remote.get(id), ...body, id, etag: `"${++etag}"` })
    },
  }
  return {
    planner,
    remote,
    calls,
    calendarId,
    api,
    create: (title, extra) =>
      planner.createEvent({ title, date: '2026-11-11', calendarId, ...extra }),
    run: () =>
      syncGoogle({
        planner,
        state,
        saveState: (next) => {
          state = structuredClone(next)
        },
        api,
        signal,
      }),
  }
}

test('Google sync exchanges timed and all-day events, edits and deletions', async () => {
  const { planner, remote, calls, calendarId, create, run } = fixture([allDay('g1', 'From Google')])
  const local = create('From Sisyphus', {
    start: '2026-11-11T18:00:00.000Z',
    end: '2026-11-11T19:00:00.000Z',
  })
  planner.createEvent({ title: 'Personal event', date: '2026-11-11' })
  assert.deepEqual(await run(), {
    pulled: 1,
    pushed: 1,
    conflicts: 0,
    skippedGoogle: 0,
    skippedLocal: 0,
    deferred: 0,
  })
  const imported = planner.list().find((item) => item.title === 'From Google')
  assert.equal(imported.calendarId, calendarId)
  assert.equal(imported.date, '2026-11-10')
  assert.equal(imported.endDate, '2026-11-12')
  const googleId = calls[0].id
  assert.match(googleId, /^[0-9a-v]{5,1024}$/)
  assert.equal(remote.get(googleId).start.dateTime, '2026-11-11T18:00:00.000Z')
  assert.equal((await run()).pushed, 0)

  planner.update({ id: imported.id, description: 'Local note' })
  remote.set(googleId, { ...remote.get(googleId), summary: 'Google edit', etag: '"3"' })
  const result = await run()
  assert.equal(result.pulled, 1)
  assert.equal(result.pushed, 1)
  assert.deepEqual(calls[1], {
    method: 'PATCH',
    id: 'g1',
    etag: '"1"',
    body: { description: 'Local note' },
  })
  assert.equal(planner.list().find((item) => item.id === local.id).title, 'Google edit')

  planner.remove({ id: local.id })
  remote.delete('g1')
  await run()
  assert.equal(calls[2].method, 'DELETE')
  assert.deepEqual(
    planner.list().map((item) => item.title),
    ['Personal event'],
  )
  assert.equal(remote.size, 0)
})

test('concurrent edits retain a local copy and settle on the Google version', async () => {
  const { planner, remote, run } = fixture([allDay('g1', 'Original')])
  await run()
  const item = planner.list()[0]
  planner.update({ id: item.id, title: 'Local edit' })
  remote.set('g1', allDay('g1', 'Remote edit', { etag: '"2"' }))
  assert.equal((await run()).conflicts, 1)
  assert.equal(planner.list().find(({ id }) => id === item.id).title, 'Remote edit')
  assert.deepEqual(
    planner
      .list()
      .filter(({ calendarId }) => calendarId === 'default')
      .map(({ title }) => title),
    ['Local edit'],
  )
  assert.equal((await run()).conflicts, 0)
  assert.equal(planner.list().length, 2)
})

test('retries adopt an insert that succeeded before its response was lost', async () => {
  const { planner, remote, calls, api, create, run } = fixture()
  const original = api.write
  api.write = async (...args) => {
    await original(...args)
    throw new Error('Connection lost')
  }
  const item = create('Only one copy')
  await assert.rejects(run(), /Connection lost/)
  assert.equal(remote.size, 1)
  assert.equal((await run()).pushed, 0)
  assert.deepEqual(
    planner.list().map(({ id }) => id),
    [item.id],
  )
  assert.equal(calls.length, 1)
})

test('a failed conditional write keeps both edits available for the next sync', async () => {
  const { planner, remote, api, run } = fixture([allDay('g1', 'Original')])
  await run()
  planner.update({ id: planner.list()[0].id, title: 'Local edit' })
  api.write = async () => {
    remote.set('g1', allDay('g1', 'Concurrent edit', { etag: '"2"' }))
    throw Object.assign(new Error('Precondition failed'), { status: 412 })
  }
  assert.equal((await run()).deferred, 1)
  assert.equal(planner.list()[0].title, 'Local edit')
  assert.equal((await run()).conflicts, 1)
  assert.deepEqual(
    planner.list().map(({ title }) => title),
    ['Concurrent edit', 'Local edit'],
  )
})

test('moving an event out of the linked calendar removes only the Google copy', async () => {
  const { planner, remote, run } = fixture([allDay('g1', 'Original')])
  await run()
  const item = planner.list()[0]
  planner.update({ id: item.id, calendarId: 'default' })
  assert.equal((await run()).pushed, 1)
  assert.equal(remote.size, 0)
  assert.deepEqual(
    planner.list().map(({ id, calendarId }) => [id, calendarId]),
    [[item.id, 'default']],
  )
})

test('recurring events, invitations and tasks stay in their source calendars', async () => {
  const { planner, calendarId, run } = fixture([
    allDay('g1', 'Series', { recurrence: ['RRULE:FREQ=DAILY'] }),
    allDay('g2', 'Meeting', { attendees: [{ email: 'guest@example.com' }] }),
  ])
  planner.create({ title: 'Task', calendarId })
  const result = await run()
  assert.equal(result.skippedGoogle, 2)
  assert.equal(result.skippedLocal, 1)
  assert.equal(result.pulled + result.pushed, 0)
  assert.equal(planner.list()[0].title, 'Task')
})

test('desktop OAuth uses PKCE, rejects an unrelated callback and exchanges the code', async () => {
  assert.deepEqual(desktopClient(JSON.stringify({ installed: client })), client)
  assert.throws(() => desktopClient(JSON.stringify({ web: client })), /Desktop app/)
  let params, callbacks
  const result = await authorize(client, {
    signal,
    openExternal(url) {
      params = new URL(url).searchParams
      assert.equal(new URL(url).hostname, 'accounts.google.com')
      assert.equal(params.get('code_challenge_method'), 'S256')
      const redirect = params.get('redirect_uri')
      assert.equal(new URL(redirect).hostname, '127.0.0.1')
      callbacks = (async () => {
        const wrong = await fetch(`${redirect}?state=wrong&code=other`)
        assert.equal(wrong.status, 404)
        await wrong.text()
        const accepted = await fetch(`${redirect}?state=${params.get('state')}&code=test-code`)
        assert.equal(accepted.status, 200)
        await accepted.text()
      })()
      return callbacks
    },
    async fetch(url, { body }) {
      assert.equal(url, 'https://oauth2.googleapis.com/token')
      assert.equal(body.get('code'), 'test-code')
      assert.equal(body.get('redirect_uri'), params.get('redirect_uri'))
      const challenge = createHash('sha256').update(body.get('code_verifier')).digest('base64url')
      assert.equal(challenge, params.get('code_challenge'))
      return Response.json({ scope: params.get('scope'), refresh_token: 'refresh' })
    },
  })
  await callbacks
  assert.deepEqual(result, { ...client, refresh_token: 'refresh' })
})

test('Google requests refresh access, follow pagination and use conditional writes', async () => {
  const api = await googleCalendar(
    { ...client, refresh_token: 'refresh' },
    {
      signal,
      async fetch(url, { headers, method, body }) {
        const target = new URL(url)
        if (target.hostname === 'oauth2.googleapis.com') {
          assert.equal(body.get('grant_type'), 'refresh_token')
          return Response.json({ access_token: 'access' })
        }
        assert.equal(headers.Authorization, 'Bearer access')
        if (method === 'DELETE') {
          assert.equal(target.pathname, '/calendar/v3/calendars/work%40example.com/events/g1')
          assert.equal(headers['If-Match'], '"1"')
          return new Response(null, { status: 204 })
        }
        assert.equal(target.pathname, '/calendar/v3/calendars/work%40example.com/events')
        return Response.json(
          target.searchParams.has('pageToken')
            ? { accessRole: 'owner', items: [allDay('g2', 'Second')] }
            : { accessRole: 'owner', items: [allDay('g1', 'First')], nextPageToken: 'next' },
        )
      },
    },
  )
  assert.deepEqual(
    (await api.events('work@example.com')).map(({ id }) => id),
    ['g1', 'g2'],
  )
  assert.equal(
    await api.write('work@example.com', { method: 'DELETE', id: 'g1', etag: '"1"' }),
    null,
  )
})

function connectionFixture(t, { setup, fetch, openExternal }) {
  const userData = mkdtempSync(path.join(tmpdir(), 'sisyphus-google-'))
  const values = new Map()
  const storage = {
    get: (scope, key) => structuredClone(values.get(`${scope}:${key}`)),
    set: (scope, key, value) => values.set(`${scope}:${key}`, structuredClone(value)),
  }
  const methods = new Map()
  const effects = []
  const planner = new PlannerRepository(storage)
  const transport = {
    handle: (name, handler) => {
      methods.set(name, handler)
      return () => methods.delete(name)
    },
  }
  const ctx = { effect: (mount) => effects.push(mount()) }
  const electron = {
    BrowserWindow: { getAllWindows: () => [] },
    dialog: { showOpenDialog: () => assert.fail('Unexpected credential file picker') },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (text) => Buffer.from(text),
      decryptString: (buffer) => buffer.toString(),
    },
    shell: { openExternal },
  }
  setup({ userData, storage })
  registerGoogleSync(ctx, { userData, storage, planner, transport, electron, fetch })
  t.after(() => {
    for (const dispose of effects.reverse()) dispose()
    rmSync(userData, { force: true, recursive: true })
  })
  return { call: (name, input) => methods.get(`planner.google.${name}`)(input), planner }
}

test('Calendar setup opens only the fixed Google Cloud pages', async (t) => {
  const opened = []
  const { call } = connectionFixture(t, {
    setup() {},
    async openExternal(url) {
      opened.push(url)
    },
  })
  assert.ok(call('status').scopes.includes('https://www.googleapis.com/auth/calendar.events'))
  await call('openSetupPage', 'clients')
  await assert.rejects(
    call('openSetupPage', 'https://example.com'),
    /Unknown Google Calendar setup page/,
  )
  assert.deepEqual(opened, ['https://console.cloud.google.com/auth/clients'])
})

test('a configured OAuth client opens Google directly and is remembered after disconnect', async (t) => {
  let config
  let consentCount = 0
  let scope
  const { call } = connectionFixture(t, {
    setup({ userData }) {
      config = path.join(userData, 'google-calendar.oauth.json')
      writeFileSync(config, JSON.stringify({ installed: client }))
    },
    async openExternal(url) {
      const target = new URL(url)
      assert.equal(target.hostname, 'accounts.google.com')
      assert.equal(target.searchParams.get('client_id'), client.client_id)
      scope = target.searchParams.get('scope')
      const redirect = new URL(target.searchParams.get('redirect_uri'))
      redirect.searchParams.set('state', target.searchParams.get('state'))
      redirect.searchParams.set('code', 'consent-code')
      consentCount++
      const response = await fetch(redirect)
      await response.text()
    },
    async fetch(url, { body }) {
      assert.equal(url, 'https://oauth2.googleapis.com/token')
      assert.equal(body.get('code'), 'consent-code')
      return Response.json({ scope, refresh_token: 'refresh' })
    },
  })
  assert.equal(call('status').hasClient, true)
  assert.equal((await call('connect')).connected, true)
  rmSync(config)
  assert.equal((await call('disconnect')).connected, false)
  assert.equal(call('status').hasClient, true)
  assert.equal((await call('connect')).connected, true)
  assert.equal(consentCount, 2)
})

test('automatic sync starts after linking, coalesces manual requests, and pauses on expired access', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const interval = 5 * 60 * 1000
  let events = 0
  let refreshes = 0
  let expired = false
  let release
  const firstRead = new Promise((resolve) => {
    release = resolve
  })
  const { call, planner } = connectionFixture(t, {
    setup({ storage }) {
      const encrypted = Buffer.from(
        JSON.stringify({ ...client, refresh_token: 'refresh' }),
      ).toString('base64')
      storage.set('planner.google', 'connection.v1', { encrypted })
    },
    async fetch(url) {
      const target = new URL(url)
      if (target.hostname === 'oauth2.googleapis.com') {
        refreshes++
        return expired
          ? new Response(null, { status: 400 })
          : Response.json({ access_token: 'access' })
      }
      if (target.pathname.endsWith('/calendarList')) {
        return Response.json({ items: [{ id: 'work', summary: 'Work', accessRole: 'owner' }] })
      }
      assert.equal(target.pathname, '/calendar/v3/calendars/work/events')
      if (++events === 1) await firstRead
      return Response.json({ accessRole: 'owner', items: [allDay('g1', 'Meeting')] })
    },
  })
  assert.equal((await call('link', 'work')).automatic, true)
  t.mock.timers.tick(0)
  await new Promise(setImmediate)
  assert.equal(call('status').syncing, true)
  const manual = call('sync')
  assert.equal(events, 1)
  release()
  assert.equal((await manual).pulled, 1)
  assert.equal(planner.list()[0].title, 'Meeting')
  assert.equal(call('status').lastSync.result.pulled, 1)

  t.mock.timers.tick(interval)
  await new Promise(setImmediate)
  assert.equal(events, 2)
  assert.equal((await call('setAutomatic', false)).automatic, false)
  t.mock.timers.tick(interval)
  await new Promise(setImmediate)
  assert.equal(events, 2)

  expired = true
  await call('setAutomatic', true)
  t.mock.timers.tick(0)
  await new Promise(setImmediate)
  assert.match(call('status').syncError, /Reconnect your Google account/)
  const before = refreshes
  t.mock.timers.tick(interval)
  await new Promise(setImmediate)
  assert.equal(refreshes, before)
})
