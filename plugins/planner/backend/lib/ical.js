'use strict'
const ICAL = require('ical.js')
const { createHash } = require('node:crypto')

const MAX_BYTES = 5 * 1024 * 1024
const dateValue = (value) => (value ? value.toString().slice(0, 10) : undefined)

// Keep complete components (including exceptions, alarms, extensions and zones).
// The projected fields are for the UI; they are not a lossy replacement for ICS.
function importCalendar(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES)
    throw new Error('Choose an ICS file smaller than 5 MB.')
  const calendar = new ICAL.Component(ICAL.parse(text))
  if (calendar.name !== 'vcalendar' || calendar.getFirstPropertyValue('version') !== '2.0')
    throw new Error('Expected an iCalendar 2.0 file.')
  const groups = new Map()
  for (const component of calendar.getAllSubcomponents()) {
    if (!['vevent', 'vtodo', 'vtimezone'].includes(component.name))
      throw new Error(
        `This file contains unsupported ${component.name} components. Nothing was imported.`,
      )
    if (component.name === 'vtimezone') continue
    const uid = component.getFirstPropertyValue('uid')
    if (!uid || typeof uid !== 'string') throw new Error('Every event or task must have a UID.')
    const key = `${component.name}:${uid}`
    const group = groups.get(key) || []
    group.push(component)
    groups.set(key, group)
  }
  if (!groups.size) throw new Error('No events or tasks were found in this file.')
  if (groups.size > 2000) throw new Error('Import at most 2,000 items at a time.')
  return [...groups].map(([key, components]) => {
    const masters = components.filter((c) => !c.hasProperty('recurrence-id'))
    if (masters.length !== 1)
      throw new Error('Each recurring series needs exactly one master component.')
    const component = masters[0]
    const start = component.getFirstPropertyValue(component.name === 'vtodo' ? 'due' : 'dtstart')
    if (component.name === 'vevent' && !start) throw new Error('An event is missing DTSTART.')
    const title = String(component.getFirstPropertyValue('summary') || 'Untitled')
    if (title.length > 500) throw new Error('An item title exceeds 500 characters.')
    const preserved = new ICAL.Component('vcalendar')
    preserved.updatePropertyWithValue('version', '2.0')
    preserved.updatePropertyWithValue('prodid', '-//Sisyphus//Calendar//EN')
    for (const zone of calendar.getAllSubcomponents('vtimezone'))
      preserved.addSubcomponent(new ICAL.Component(zone.toJSON()))
    for (const c of components) preserved.addSubcomponent(new ICAL.Component(c.toJSON()))
    return {
      id: createHash('sha256').update(key).digest('hex'),
      uid: component.getFirstPropertyValue('uid'),
      kind: component.name === 'vtodo' ? 'todo' : 'event',
      title,
      date: dateValue(start),
      description: String(component.getFirstPropertyValue('description') || ''),
      location: String(component.getFirstPropertyValue('location') || ''),
      done: component.getFirstPropertyValue('status') === 'COMPLETED',
      ical: preserved.toString(),
    }
  })
}

function utc(value) {
  return ICAL.Time.fromJSDate(new Date(value), true)
}
function day(value) {
  return ICAL.Time.fromDateString(value)
}
function exportCalendar(records) {
  const calendar = new ICAL.Component('vcalendar')
  calendar.updatePropertyWithValue('version', '2.0')
  calendar.updatePropertyWithValue('prodid', '-//Sisyphus//Calendar//EN')
  const zones = new Map()
  for (const item of records.filter((item) => !item.deleted)) {
    const source = item.ical ? new ICAL.Component(ICAL.parse(item.ical)) : null
    if (source) {
      for (const zone of source.getAllSubcomponents('vtimezone')) {
        const id = zone.getFirstPropertyValue('tzid')
        if (zones.has(id) && zones.get(id) !== zone.toString())
          throw new Error(
            `Conflicting definitions for time zone ${id}. Export these calendars separately.`,
          )
        if (!zones.has(id)) calendar.addSubcomponent(zone)
        zones.set(id, zone.toString())
      }
    }
    const components = source
      ? source.getAllSubcomponents(item.kind === 'event' ? 'vevent' : 'vtodo')
      : [new ICAL.Component(item.kind === 'event' ? 'vevent' : 'vtodo')]
    for (const component of components) {
      // Exceptions retain their own titles/times. Editing an imported series is
      // intentionally limited to master text, avoiding accidental rescheduling.
      if (!component.hasProperty('recurrence-id')) {
        component.updatePropertyWithValue('summary', item.title)
        component.updatePropertyWithValue('description', item.description || '')
        component.updatePropertyWithValue('location', item.location || '')
        if (item.kind === 'todo') {
          component.updatePropertyWithValue('status', item.done ? 'COMPLETED' : 'NEEDS-ACTION')
          component.updatePropertyWithValue('percent-complete', item.done ? 100 : 0)
          if (item.done) component.updatePropertyWithValue('completed', utc(item.updatedAt))
          else component.removeAllProperties('completed')
        }
      }
      if (!source) {
        component.updatePropertyWithValue('uid', item.uid || `${item.id}@sisyphus.local`)
        if (item.kind === 'todo' && item.date)
          component.updatePropertyWithValue('due', day(item.date))
        if (item.kind === 'event') {
          component.updatePropertyWithValue(
            'dtstart',
            item.start ? utc(item.start) : day(item.date),
          )
          if (item.end) component.updatePropertyWithValue('dtend', utc(item.end))
          else if (item.endDate) component.updatePropertyWithValue('dtend', day(item.endDate))
        }
      }
      component.updatePropertyWithValue('dtstamp', utc(item.updatedAt))
      calendar.addSubcomponent(component)
    }
  }
  // RFC 5545 folds at 75 octets, not 75 JS characters (including continuation).
  const unfolded = calendar.toString().replace(/\r?\n[ \t]/g, '')
  return (
    unfolded
      .split(/\r?\n/)
      .map((line) => {
        let result = '',
          bytes = 0
        for (const char of line) {
          const length = Buffer.byteLength(char)
          if (bytes + length > 75) {
            result += '\r\n '
            bytes = 1
          }
          result += char
          bytes += length
        }
        return result
      })
      .join('\r\n') + '\r\n'
  )
}
module.exports = { importCalendar, exportCalendar, MAX_BYTES }
