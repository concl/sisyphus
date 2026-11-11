const { createHash, randomUUID } = require('node:crypto')
const { createSchema, validateItem } = require('./planner-data.js')

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const version = (event) => (event ? digest(event) : null)
const calendarOf = (item) => item?.calendarId || 'default'
const liveIn = (item, calendar) => item && !item.deleted && calendarOf(item) === calendar
function eventFields(item) {
  return {
    summary: item.title,
    description: item.description || '',
    location: item.location || '',
    start: item.start ? { dateTime: new Date(item.start).toISOString() } : { date: item.date },
    end: item.end
      ? { dateTime: new Date(item.end).toISOString() }
      : { date: item.endDate || nextDay(item.date) },
  }
}

function localEvent(item) {
  if (item.kind !== 'event' || item.ical || !item.title.trim()) return null
  try {
    return eventFields(validateItem(item))
  } catch {
    return null
  }
}

function nextDay(day) {
  return new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)
}

function remoteEvent(event) {
  if (
    !event.etag ||
    event.recurringEventId ||
    event.recurrence?.length ||
    (event.eventType && event.eventType !== 'default') ||
    event.attendees?.length ||
    event.attendeesOmitted ||
    event.organizer?.self === false ||
    event.locked
  )
    return null
  try {
    const start = event.start.dateTime && new Date(event.start.dateTime).toISOString()
    const end = event.end.dateTime && new Date(event.end.dateTime).toISOString()
    const item = validateItem(
      createSchema.parse({
        kind: 'event',
        title: event.summary?.trim() || 'Untitled event',
        description: event.description || '',
        location: event.location || '',
        date: event.start.date || start?.slice(0, 10),
        ...(start ? { start, end } : { endDate: event.end.date }),
      }),
    )
    return eventFields(item)
  } catch {
    return null
  }
}

function pulledItem(event, id, calendarId, current, actor) {
  const { start, end } = event || {}
  const instant = start?.dateTime && new Date(start.dateTime)
  const localDate =
    instant &&
    new Date(instant.getTime() - instant.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const time = Math.max(Date.now(), current ? Date.parse(current.updatedAt) + 1 : 0)
  return {
    id,
    uid: current?.uid || `${id}@sisyphus.local`,
    kind: 'event',
    title: event?.summary ?? current.title,
    description: event?.description ?? current.description,
    location: event?.location ?? current.location,
    date: start?.date || localDate || current?.date,
    endDate: end?.date,
    start: start?.dateTime,
    end: end?.dateTime,
    starred: current?.starred,
    deleted: !event,
    calendarId,
    actor,
    updatedAt: new Date(time).toISOString(),
  }
}

function eventPatch(outgoing, incoming) {
  const patch = Object.fromEntries(
    Object.entries(outgoing).filter(([key, value]) => digest(value) !== digest(incoming[key])),
  )
  // Clear the previous representation when switching between date-only and timed.
  if (outgoing.start.date && incoming.start.dateTime) {
    patch.start = { ...patch.start, dateTime: null, timeZone: null }
    patch.end = { ...patch.end, dateTime: null, timeZone: null }
  } else if (outgoing.start.dateTime && incoming.start.date) {
    patch.start = { ...patch.start, date: null }
    patch.end = { ...patch.end, date: null }
  }
  return patch
}

// Remote bindings live outside the portable document. Their last shared content
// version distinguishes local changes from remote changes without relying on clocks.
async function syncGoogle({ planner, state, saveState, api, signal }) {
  const { localId, remoteId } = state.binding
  const remote = new Map(
    (await api.events(remoteId))
      .filter((event) => event.status !== 'cancelled')
      .map((event) => [event.id, event]),
  )
  signal.throwIfAborted()
  const links = new Map(state.links.map((link) => [link.remote, { ...link }]))
  const document = planner.document()
  const records = new Map(document.records.map((item) => [item.id, item]))
  const result = {
    pulled: 0,
    pushed: 0,
    conflicts: 0,
    skippedGoogle: 0,
    skippedLocal: 0,
    deferred: 0,
  }
  const writes = []
  const linked = new Set()
  const saveLinks = () => saveState({ ...state, links: [...links.values()] })
  for (const key of new Set([...remote.keys(), ...links.keys()])) {
    const entry = remote.get(key)
    const incoming = entry && remoteEvent(entry)
    const link = links.get(key) || { remote: key, id: digest([localId, key]), base: null }
    linked.add(link.id)
    const current = records.get(link.id)
    const local = liveIn(current, localId)
    const outgoing = local ? localEvent(current) : null
    if (local && !outgoing) result.skippedLocal++
    if (entry && !incoming) result.skippedGoogle++
    if ((entry && !incoming) || (local && !outgoing)) continue
    const localVersion = version(outgoing)
    const remoteVersion = version(incoming)
    if (localVersion === remoteVersion) {
      if (incoming) links.set(key, { ...link, base: remoteVersion })
      else links.delete(key)
      continue
    }
    if (current && remoteVersion === link.base) {
      writes.push({ link, entry, incoming, outgoing })
      continue
    }
    if (current && localVersion !== link.base) {
      result.conflicts++
      if (outgoing) {
        // Stable across retries if the app exits between saving records and links.
        const id = digest([link.id, current.updatedAt, localVersion])
        if (!records.has(id))
          records.set(id, {
            ...current,
            id,
            uid: `${id}@sisyphus.local`,
            calendarId: 'default',
          })
      }
    }
    if (incoming || local) {
      const id =
        current && calendarOf(current) !== localId ? digest([localId, key, link.id]) : link.id
      linked.add(id)
      records.set(id, pulledItem(incoming, id, localId, records.get(id), planner.actor))
      result.pulled++
      if (incoming) links.set(key, { remote: key, id, base: remoteVersion })
    }
    if (!incoming) links.delete(key)
  }
  for (const item of document.records) {
    if (!liveIn(item, localId) || linked.has(item.id)) continue
    const outgoing = localEvent(item)
    if (!outgoing) {
      result.skippedLocal++
      continue
    }
    const remote = randomUUID().replaceAll('-', '')
    writes.push({ link: { remote, id: item.id, base: null }, outgoing })
  }
  if (result.pulled)
    planner.save({ ...document, records: [...records.values()] }, { source: 'google' })
  saveLinks()

  for (const { link, entry, incoming, outgoing } of writes) {
    signal.throwIfAborted()
    const latest = planner.document().records.find((item) => item.id === link.id)
    const live = liveIn(latest, localId)
    const current = live ? localEvent(latest) : null
    if (!latest || (live && !current) || version(current) !== version(outgoing)) {
      result.deferred++
      continue
    }
    const method = outgoing ? (entry ? 'PATCH' : 'POST') : 'DELETE'
    if (method === 'POST') {
      // Save the event ID before writing so a retry can find an insert that succeeded.
      links.set(link.remote, link)
      saveLinks()
    }
    const body =
      method === 'POST'
        ? { ...outgoing, id: link.remote }
        : method === 'PATCH'
          ? eventPatch(outgoing, incoming)
          : undefined
    try {
      await api.write(remoteId, { method, id: link.remote, etag: entry?.etag, body })
    } catch (error) {
      if ([404, 409, 410, 412].includes(error.status)) {
        result.deferred++
        continue
      }
      throw error
    }
    signal.throwIfAborted()
    if (outgoing) links.set(link.remote, { ...link, base: version(outgoing) })
    else links.delete(link.remote)
    saveLinks()
    result.pushed++
  }
  return result
}

module.exports = { syncGoogle, localEvent }
