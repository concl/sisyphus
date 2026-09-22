const { randomUUID } = require('node:crypto')
const { z } = require('zod')
const { empty, merge } = require('./planner-sync.js')

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }, 'Use a valid calendar date')
const createSchema = z
  .object({
    kind: z.enum(['todo', 'event']).default('todo'),
    title: z.string().trim().min(1).max(500),
    date: date.optional(),
  })
  .strict()
const updateSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().trim().min(1).max(500).optional(),
    date: date.nullable().optional(),
    done: z.boolean().optional(),
  })
  .strict()
const idSchema = z.object({ id: z.string().min(1) }).strict()

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
    this.storage.set('planner', 'document.v1', document)
    this.changed(document)
    return document
  }
  create(input) {
    const fields = createSchema.parse(input)
    if (fields.kind === 'event' && !fields.date) throw new Error('Events need a date')
    const item = {
      ...fields,
      id: randomUUID(),
      done: false,
      updatedAt: new Date().toISOString(),
      actor: this.actor,
    }
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
    if (!previous) throw new Error('Planner item no longer exists')
    const time = Math.max(Date.now(), Date.parse(previous.updatedAt) + 1)
    const next = {
      ...previous,
      ...fields,
      updatedAt: new Date(time).toISOString(),
      actor: this.actor,
    }
    if (next.date === null) delete next.date
    this.save({
      schema: 1,
      records: document.records.map((item) => (item.id === id ? next : item)),
    })
    return next
  }
  merge(document) {
    return this.save(merge(this.document(), document))
  }
}
module.exports = { PlannerRepository, createSchema, updateSchema, idSchema }
