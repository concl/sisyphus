const { test } = require('node:test')
const assert = require('node:assert/strict')
const ICAL = require('ical.js')
const { PlannerRepository } = require('../../../plugins/planner/backend/lib/planner-data.js')
const { importCalendar, exportCalendar } = require('../../../plugins/planner/backend/lib/ical.js')
const fixture = () => {
  const storage = new Map()
  return new PlannerRepository({
    get: (scope, key) => storage.get(scope + key),
    set: (scope, key, value) => storage.set(scope + key, value),
  })
}
const wrap = (content) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Tests//EN\r\n${content}\r\nEND:VCALENDAR\r\n`
const event = (uid = 'event@example.org') =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20260901T000000Z\r\nDTSTART;VALUE=DATE:20260926\r\nDTEND;VALUE=DATE:20260928\r\nSUMMARY:Weekend\r\nEND:VEVENT`

test('existing tasks survive and new events have valid start/end semantics', () => {
  const repo = fixture()
  const task = repo.create({ title: 'Existing task', date: '2026-09-26' })
  repo.update({ id: task.id, date: null, done: true })
  assert.equal(repo.list()[0].date, undefined)
  assert.equal(repo.list()[0].done, true)
  assert.throws(() => repo.create({ title: 'Bad', kind: 'event' }))
  assert.throws(() => repo.create({ title: 'Bad', kind: 'event', date: '2026-02-30' }))
  assert.throws(() =>
    repo.create({
      title: 'Bad',
      kind: 'event',
      date: '2026-09-26',
      start: '2026-09-26T10:00:00Z',
      end: '2026-09-26T09:00:00Z',
    }),
  )
  const timed = repo.create({
    title: 'Meeting',
    kind: 'event',
    date: '2026-09-26',
    start: '2026-09-26T10:00:00Z',
    end: '2026-09-26T11:00:00Z',
  })
  assert.throws(() => repo.update({ id: timed.id, date: null }))
  assert.equal(repo.list().length, 2)
})

test('ICS imports are atomic and UID-idempotent even after local edits and deletion', () => {
  const repo = fixture()
  assert.deepEqual(repo.importICS(wrap(event())), { added: 1, skipped: 0 })
  const item = repo.list()[0]
  repo.update({ id: item.id, title: 'My edit' })
  assert.deepEqual(repo.importICS(wrap(event())), { added: 0, skipped: 1 })
  assert.equal(repo.list()[0].title, 'My edit')
  assert.throws(() =>
    repo.importICS(wrap(event('new') + '\r\nBEGIN:VEVENT\r\nSUMMARY:Missing UID\r\nEND:VEVENT')),
  )
  assert.equal(repo.list().length, 1)
  repo.remove({ id: item.id })
  assert.equal(repo.importICS(wrap(event())).added, 0)
  assert.equal(repo.list().length, 0)
})

test('roundtrip local UTC events and undated completed VTODO with escaped text', () => {
  const repo = fixture()
  const item = repo.create({
    title: 'Plan; review, next\\step',
    description: 'Line one\nLine two',
    kind: 'todo',
  })
  repo.update({ id: item.id, done: true })
  repo.create({
    title: 'UTC',
    kind: 'event',
    date: '2026-09-26',
    start: '2026-09-26T22:00:00Z',
    end: '2026-09-27T01:00:00Z',
  })
  const exported = repo.exportICS()
  const parsed = new ICAL.Component(ICAL.parse(exported))
  const task = parsed.getFirstSubcomponent('vtodo')
  assert.equal(task.getFirstPropertyValue('summary'), item.title)
  assert.equal(task.getFirstPropertyValue('description'), 'Line one\nLine two')
  assert.equal(task.getFirstPropertyValue('status'), 'COMPLETED')
  assert.equal(task.hasProperty('due'), false)
  assert.equal(
    parsed.getFirstSubcomponent('vevent').getFirstPropertyValue('dtstart').toString(),
    '2026-09-26T22:00:00Z',
  )
  assert.equal(fixture().importICS(exported).added, 2)
  assert.equal(repo.importICS(exported).added, 0)
})

test('all-day end is exclusive and raw recurrence, exceptions, alarms and extensions survive', () => {
  const source = wrap(
    event().replace(
      'SUMMARY:Weekend',
      'RRULE:FREQ=WEEKLY;COUNT=3\r\nEXDATE;VALUE=DATE:20261003\r\nX-EXAMPLE:keep me\r\nSUMMARY:Weekend\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:Reminder\r\nEND:VALARM',
    ) +
      '\r\n' +
      event()
        .replace(
          'DTSTART;VALUE=DATE:20260926',
          'RECURRENCE-ID;VALUE=DATE:20261010\r\nDTSTART;VALUE=DATE:20261011',
        )
        .replace('DTEND;VALUE=DATE:20260928', 'DTEND;VALUE=DATE:20261012'),
  )
  const repo = fixture()
  repo.importICS(source)
  const item = repo.list()[0]
  assert.throws(() => repo.update({ id: item.id, date: '2026-10-01' }))
  repo.update({ id: item.id, title: 'New title' })
  const exported = repo.exportICS()
  const parsed = new ICAL.Component(ICAL.parse(exported))
  assert.equal(parsed.getAllSubcomponents('vevent').length, 2)
  const master = parsed.getFirstSubcomponent('vevent')
  assert.equal(master.getFirstPropertyValue('dtend').toString(), '2026-09-28')
  assert.equal(master.getFirstPropertyValue('summary'), 'New title')
  assert.equal(master.getFirstPropertyValue('x-example'), 'keep me')
  assert.ok(master.getFirstSubcomponent('valarm'))
  assert.ok(master.hasProperty('rrule'))
  assert.ok(master.hasProperty('exdate'))
})

test('UTF-8 folding obeys the 75-octet limit and survives parsing', () => {
  const repo = fixture()
  const title = '工作📅'.repeat(70)
  repo.create({ title })
  const text = repo.exportICS()
  for (const line of text.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75)
  assert.equal(importCalendar(text)[0].title, title)
})

test('invalid or unsupported files fail clearly instead of partially importing', () => {
  assert.throws(() => importCalendar('not a calendar'))
  assert.throws(() => importCalendar('x'.repeat(5 * 1024 * 1024 + 1)))
  assert.throws(() => importCalendar(wrap('BEGIN:VJOURNAL\r\nUID:journal\r\nEND:VJOURNAL')))
  assert.throws(() => importCalendar(wrap(event() + '\r\n' + event())))
})

test('timezone definitions and imported completed tasks roundtrip', () => {
  const zone =
    'BEGIN:VTIMEZONE\r\nTZID:Example/Fixed\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0200\r\nEND:STANDARD\r\nEND:VTIMEZONE'
  const source = wrap(
    zone +
      '\r\nBEGIN:VTODO\r\nUID:task@example.org\r\nDUE;TZID=Example/Fixed:20260926T090000\r\nSTATUS:COMPLETED\r\nSUMMARY:Done\r\nEND:VTODO',
  )
  const records = importCalendar(source).map((i) => ({ ...i, updatedAt: new Date().toISOString() }))
  const parsed = new ICAL.Component(ICAL.parse(exportCalendar(records)))
  assert.equal(parsed.getAllSubcomponents('vtimezone').length, 1)
  assert.equal(
    parsed.getFirstSubcomponent('vtodo').getFirstProperty('due').getParameter('tzid'),
    'Example/Fixed',
  )
  assert.equal(records[0].done, true)
})
