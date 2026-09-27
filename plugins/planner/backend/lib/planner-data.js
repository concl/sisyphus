const { randomUUID } = require('node:crypto')
const { z } = require('zod')
const { empty, merge } = require('./planner-sync.js')
const { importCalendar, exportCalendar } = require('./ical.js')

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }, 'Use a valid calendar date')
const fields = {
  kind: z.enum(['todo', 'event']),
  title: z.string().trim().min(1).max(500),
  date: date.nullable(),
  endDate: date.nullable(),
  start: z.iso.datetime().nullable(),
  end: z.iso.datetime().nullable(),
  description: z.string().max(20000),
  location: z.string().max(2000),
  list: z.string().trim().min(1).max(100),
  starred: z.boolean(),
  done: z.boolean(),
}
const createSchema = z
  .object(fields)
  .partial()
  .extend({
    title: fields.title,
    kind: fields.kind.default('todo'),
  })
  .strict()
const updateSchema = z
  .object(fields)
  .partial()
  .extend({ id: z.string().min(1) })
  .strict()
const idSchema = z.object({ id: z.string().min(1) }).strict()

function validateItem(item) {
  if (item.kind === 'event' && !item.date) throw new Error('Events need a date')
  if (!!item.start !== !!item.end) throw new Error('Choose both a start and end time')
  if (item.start && Date.parse(item.end) <= Date.parse(item.start))
    throw new Error('End must be after start')
  if (item.endDate && (!item.date || item.endDate <= item.date))
    throw new Error('End date must be after start date')
  if (item.kind === 'todo' && (item.start || item.end || item.endDate))
    throw new Error('Tasks use a due date, not an event time')
  if (item.start && item.endDate) throw new Error('Choose a timed or an all-day event')
  return item
}
class PlannerRepository {
  constructor(storage, changed = () => {}) {
    this.storage = storage
    this.changed = changed
    this.actor = storage.get('planner', 'actor.v1') || randomUUID()
    storage.set('planner', 'actor.v1', this.actor)
  }
  document() {
    return this.storage.get('planner', 'document.v1') || empty()
  }
  list() {
    return this.document().records.filter((item) => !item.deleted)
  }
  save(document) {
    if (document.records.length > 10000)
      throw new Error('Calendar has reached its 10,000 item limit')
    this.storage.set('planner', 'document.v1', document)
    this.changed(document)
    return document
  }
  create(input) {
    const fields = createSchema.parse(input)
    const id = randomUUID()
    const item = validateItem({
      ...fields,
      id,
      uid: `${id}@sisyphus.local`,
      done: fields.done ?? false,
      updatedAt: new Date().toISOString(),
      actor: this.actor,
    })
    this.save({ schema: 1, records: [...this.document().records, item] })
    return item
  }
  update(input) {
    const { id, ...fields } = updateSchema.parse(input)
    return this.change(id, fields)
  }
  remove(input) {
    return this.change(idSchema.parse(input).id, { deleted: true })
  }
  change(id, fields) {
    const document = this.document()
    const previous = document.records.find((item) => item.id === id && !item.deleted)
    if (!previous) throw new Error('Calendar item no longer exists')
    if (previous.ical && ['kind', 'date', 'endDate', 'start', 'end'].some((key) => key in fields))
      throw new Error(
        'Imported schedules are preserved. Change their times in the source calendar.',
      )
    const time = Math.max(Date.now(), Date.parse(previous.updatedAt) + 1)
    const next = {
      ...previous,
      ...fields,
      updatedAt: new Date(time).toISOString(),
      actor: this.actor,
    }
    for (const key of ['date', 'start', 'end', 'endDate']) if (next[key] === null) delete next[key]
    if (!next.ical) validateItem(next)
    this.save({
      schema: 1,
      records: document.records.map((item) => (item.id === id ? next : item)),
    })
    return next
  }
  importICS(text) {
    // Parse and validate the entire file before committing; UIDs make re-import
    // idempotent and existing edits/deletion tombstones always win.
    const imported = importCalendar(text)
    const previous = this.document()
    const identities = new Set(
      previous.records.map((item) => `${item.kind}:${item.uid || `${item.id}@sisyphus.local`}`),
    )
    const added = imported
      .filter((item) => !identities.has(`${item.kind}:${item.uid}`))
      .map((item) => ({ ...item, updatedAt: new Date().toISOString(), actor: this.actor }))
    if (added.length) this.save({ schema: 1, records: [...previous.records, ...added] })
    return { added: added.length, skipped: imported.length - added.length }
  }
  exportICS() {
    return exportCalendar(this.list())
  }
  merge(document) {
    return this.save(merge(this.document(), document))
  }
}
module.exports = { PlannerRepository, createSchema, updateSchema, idSchema }
