'use strict'
function jsonValue(value) {
  const seen = new Set()
  function check(item, depth) {
    if (depth > 32) throw new Error('Data is nested too deeply')
    if (item === null || ['string', 'boolean'].includes(typeof item)) return
    if (typeof item === 'number' && Number.isFinite(item)) return
    if (
      !item ||
      typeof item !== 'object' ||
      seen.has(item) ||
      (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item)))
    )
      throw new Error('Use JSON-compatible data')
    seen.add(item)
    Object.values(item).forEach((child) => check(child, depth + 1))
    seen.delete(item)
  }
  check(value, 0)
  const encoded = JSON.stringify(value)
  if (encoded.length > 1024 * 1024) throw new Error('Data exceeds 1 MB')
  return JSON.parse(encoded)
}

module.exports = { jsonValue }
