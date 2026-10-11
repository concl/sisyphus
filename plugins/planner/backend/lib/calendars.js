const { z } = require('zod')

const calendarId = z.string().regex(/^[\w-]{1,80}$/)
const calendarFields = z
  .object({
    name: z.string().trim().min(1).max(100),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .strict()
const calendarSchema = calendarFields.extend({ id: calendarId.optional() })
const importTargetSchema = z
  .object({
    calendarId: calendarId.optional(),
    newCalendar: calendarFields.optional(),
  })
  .strict()
  .refine((input) => !(input.calendarId && input.newCalendar), 'Choose one destination')
const defaultCalendar = {
  id: 'default',
  name: 'My calendar',
  color: '#4285f4',
  updatedAt: '1970-01-01T00:00:00.000Z',
  actor: '',
}
const calendarsOf = (document) =>
  document.calendars?.length ? document.calendars : [defaultCalendar]
module.exports = { calendarId, calendarSchema, importTargetSchema, defaultCalendar, calendarsOf }
