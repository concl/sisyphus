const { createHash, randomBytes } = require('node:crypto')
const { createServer } = require('node:http')
const { setTimeout: delay } = require('node:timers/promises')
const { z } = require('zod')

const authorizeURL = 'https://accounts.google.com/o/oauth2/v2/auth'
const tokenURL = 'https://oauth2.googleapis.com/token'
const apiURL = 'https://www.googleapis.com/calendar/v3'
const scopes = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events',
]

class GoogleError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

class GoogleReconnectError extends Error {
  constructor() {
    super('Google Calendar access expired or was revoked. Reconnect your Google account.')
  }
}

async function request(fetch, url, signal, options = {}) {
  const response = await fetch(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
  })
  if (!response.ok)
    throw new GoogleError(
      `Google Calendar request failed (HTTP ${response.status}).`,
      response.status,
    )
  return response.status === 204 ? null : response.json()
}

async function readPage(call, path, signal) {
  for (const wait of [0, 500, 1500]) {
    if (wait) await delay(wait, undefined, { signal })
    try {
      return await call(path)
    } catch (error) {
      if (wait === 1500 || ![429, 500, 502, 503, 504].includes(error.status)) throw error
    }
  }
}

function desktopClient(text) {
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('Choose a valid Google OAuth client JSON file.')
  }
  const client = z
    .object({
      installed: z.object({
        client_id: z.string().max(512).endsWith('.apps.googleusercontent.com'),
        client_secret: z.string().min(1).max(512),
      }),
    })
    .safeParse(json)
  if (!client.success) throw new Error('Choose a Google OAuth client JSON file for a Desktop app.')
  return client.data.installed
}

async function authorize(client, { openExternal, fetch, signal }) {
  const verifier = randomBytes(48).toString('base64url')
  const state = randomBytes(32).toString('base64url')
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(180000)])
  let redirect
  const server = createServer()
  try {
    const code = await new Promise((resolve, reject) => {
      const abort = () => reject(new Error('Google sign-in was cancelled or timed out.'))
      timeout.addEventListener('abort', abort, { once: true })
      server.once('close', () => timeout.removeEventListener('abort', abort))
      server.once('error', reject)
      server.on('request', (req, res) => {
        const callback = req.url?.startsWith('/oauth2callback?')
          ? new URL('http://127.0.0.1' + req.url)
          : null
        if (req.method !== 'GET' || callback?.searchParams.get('state') !== state) {
          res.writeHead(404, { Connection: 'close' }).end()
          return
        }
        const code = callback.searchParams.get('code')
        res
          .writeHead(code ? 200 : 400, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
            Connection: 'close',
          })
          .end(
            code ? 'Return to Sisyphus to finish setup.' : 'Google sign-in was declined.',
            () => {
              if (code) resolve(code)
              else reject(new Error('Google Calendar access was declined.'))
            },
          )
      })
      server.listen({ port: 0, host: '127.0.0.1', signal: timeout }, () => {
        redirect = `http://127.0.0.1:${server.address().port}/oauth2callback`
        const params = new URLSearchParams({
          client_id: client.client_id,
          redirect_uri: redirect,
          response_type: 'code',
          scope: scopes.join(' '),
          state,
          code_challenge: createHash('sha256').update(verifier).digest('base64url'),
          code_challenge_method: 'S256',
          access_type: 'offline',
          prompt: 'consent select_account',
        })
        Promise.resolve()
          .then(() => openExternal(`${authorizeURL}?${params}`))
          .catch(reject)
      })
      if (timeout.aborted) abort()
    })
    const token = await exchange(fetch, signal, {
      ...client,
      code,
      code_verifier: verifier,
      redirect_uri: redirect,
      grant_type: 'authorization_code',
    })
    const granted = new Set(String(token.scope || '').split(/\s+/))
    if (typeof token.refresh_token !== 'string' || scopes.some((scope) => !granted.has(scope)))
      throw new Error('Allow both Calendar permissions in Google to connect.')
    return { ...client, refresh_token: token.refresh_token }
  } finally {
    server.close()
    if (timeout.aborted) server.closeAllConnections()
  }
}

async function exchange(fetch, signal, fields) {
  try {
    return await request(fetch, tokenURL, signal, {
      method: 'POST',
      body: new URLSearchParams(fields),
    })
  } catch (error) {
    if ([400, 401].includes(error.status)) {
      if (fields.grant_type === 'refresh_token') throw new GoogleReconnectError()
      throw new Error(
        'Google declined the connection. Check the Desktop app credentials and reconnect.',
      )
    }
    throw error
  }
}

async function googleCalendar(credentials, { fetch, signal }) {
  const token = await exchange(fetch, signal, { ...credentials, grant_type: 'refresh_token' })
  if (typeof token.access_token !== 'string')
    throw new Error('Google did not issue an access token.')
  const call = (path, options = {}) =>
    request(fetch, `${apiURL}${path}`, signal, {
      ...options,
      headers: { Authorization: `Bearer ${token.access_token}`, ...options.headers },
    })
  async function list(path, options, limit, checkPage = () => {}) {
    const entries = []
    const seen = new Set()
    let pageToken
    do {
      const params = new URLSearchParams(options)
      if (pageToken) params.set('pageToken', pageToken)
      const page = await readPage(call, `${path}?${params}`, signal)
      checkPage(page)
      entries.push(...(page.items || []))
      if (entries.length > limit || seen.has(page.nextPageToken))
        throw new Error('Google Calendar returned too many results to sync.')
      pageToken = page.nextPageToken
      if (pageToken) seen.add(pageToken)
    } while (pageToken)
    return entries
  }
  const eventPath = (calendar, id) =>
    `/calendars/${encodeURIComponent(calendar)}/events${id ? `/${encodeURIComponent(id)}` : ''}`
  return {
    async calendars() {
      const entries = await list('/users/me/calendarList', { minAccessRole: 'writer' }, 1000)
      return entries
        .filter((entry) => ['owner', 'writer'].includes(entry.accessRole))
        .map((entry) => ({
          id: entry.id,
          name: (entry.summaryOverride || entry.summary || 'Google Calendar').slice(0, 100),
          color: /^#[0-9a-f]{6}$/i.test(entry.backgroundColor) ? entry.backgroundColor : '#4285f4',
        }))
    },
    events: (calendar) =>
      list(eventPath(calendar), { maxResults: '2500', singleEvents: 'false' }, 10000, (page) => {
        if (!['owner', 'writer'].includes(page.accessRole))
          throw new Error('You need edit access to the linked Google calendar.')
      }),
    write(calendar, { method, id, etag, body }) {
      return call(`${eventPath(calendar, method === 'POST' ? null : id)}?sendUpdates=none`, {
        method,
        headers: {
          ...(etag && { 'If-Match': etag }),
          ...(body && { 'Content-Type': 'application/json' }),
        },
        ...(body && { body: JSON.stringify(body) }),
      })
    },
  }
}

module.exports = { authorize, desktopClient, googleCalendar, GoogleReconnectError, scopes }
