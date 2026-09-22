// Which plugins a person turned off, remembered per device.
//
// The composed profile knows a plugin's *current* state; this module is the only
// thing that makes a toggle outlive a reload. Both processes share one document
// through the storage service, so a plugin switched off in either one stays off.
// A plugin that is not in the document keeps its composed default (on), which is
// also what a plugin added later gets.

/** Scope and key of the shared document: storage/app.json. */
export const PLUGIN_STATES_SCOPE = 'app'
export const PLUGIN_STATES_KEY = 'profile.plugins.v1'

/** Reads the stored switches. Anything unrecognizable is ignored, never fatal. */
export async function readStates(storage) {
  const value = await storage.get(PLUGIN_STATES_SCOPE, PLUGIN_STATES_KEY)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const states = {}
  for (const [id, enabled] of Object.entries(value)) {
    if (typeof enabled === 'boolean') states[id] = enabled
  }
  return states
}

/** Records one switch, leaving every other plugin's choice untouched. */
export async function writeState(storage, id, enabled) {
  if (typeof enabled !== 'boolean') throw new Error('Expected enabled boolean')
  const states = await readStates(storage)
  states[id] = enabled
  await storage.set(PLUGIN_STATES_SCOPE, PLUGIN_STATES_KEY, states)
  return states
}

/**
 * Applies the stored switches to a freshly mounted profile. Only plugins this
 * process composes are touched: the document is shared, so it also holds ids the
 * other process owns. Returns the ids that were switched off.
 */
export async function applyStates(profile, storage) {
  const states = await readStates(storage)
  const known = new Set(profile.list().map((plugin) => plugin.id))
  const off = []
  for (const [id, enabled] of Object.entries(states)) {
    if (enabled || !known.has(id)) continue
    await profile.setEnabled(id, false)
    off.push(id)
  }
  return off
}
