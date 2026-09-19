'use strict'
const fs = require('node:fs')
const path = require('node:path')

const empty = () => ({ schema: 1, records: [] })

function validate(document) {
  if (!document || document.schema !== 1 || !Array.isArray(document.records))
    throw new Error('Unsupported planner document')
  if (document.records.length > 10000) throw new Error('Planner document is too large')
  for (const item of document.records) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !/^[\w-]{1,80}$/.test(item.id) ||
      !['todo', 'event'].includes(item.kind) ||
      typeof item.title !== 'string' ||
      item.title.length > 500 ||
      typeof item.updatedAt !== 'string' ||
      typeof item.actor !== 'string'
    )
      throw new Error('Invalid planner record')
  }
  return document
}

function merge(local, remote) {
  const result = new Map()
  for (const record of [...validate(remote).records, ...validate(local).records]) {
    const previous = result.get(record.id)
    if (
      !previous ||
      `${record.updatedAt}:${record.actor}` > `${previous.updatedAt}:${previous.actor}`
    )
      result.set(record.id, record)
  }
  return { schema: 1, records: [...result.values()].sort((a, b) => a.id.localeCompare(b.id)) }
}

// A cloud provider only needs to implement read() and write(document).
// A mirrored cloud directory is the first adapter, with no account coupling.
class FolderDocumentTransport {
  constructor(directory) {
    this.file = path.join(directory, 'sisyphus-planner.json')
  }
  read() {
    try {
      return validate(JSON.parse(fs.readFileSync(this.file, 'utf8')))
    } catch (error) {
      if (error.code === 'ENOENT') return empty()
      throw error
    }
  }
  write(document) {
    validate(document)
    const temporary = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(document, null, 2))
    fs.renameSync(temporary, this.file)
  }
}

async function syncDocument(local, transport) {
  const merged = merge(local, await transport.read())
  await transport.write(merged)
  return merged
}

module.exports = { empty, validate, merge, FolderDocumentTransport, syncDocument }
