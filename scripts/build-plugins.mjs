#!/usr/bin/env node
// A distribution ships editable source packages, including native code and assets.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import compiler from '../bootstrap/backend/lib/plugin-compiler.js'
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const source = path.join(root, 'plugins')
const output = path.join(root, 'build', 'plugins')
if (!output.startsWith(root + path.sep)) throw new Error('Output escaped repository')
fs.rmSync(output, { recursive: true, force: true })
fs.mkdirSync(output, { recursive: true })
for (const folder of fs.readdirSync(source, { withFileTypes: true })) {
  if (!folder.isDirectory()) continue
  for (const file of compiler.filesIn(path.join(source, folder.name))) {
    const dest = path.join(output, path.relative(source, file))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(file, dest)
  }
}
const plugins = []
for (const entry of compiler.packages(output)) {
  if (entry.error) throw new Error(entry.error)
  await compiler.compile(entry)
  const files = compiler.filesIn(entry.folder).map(file => ({
    name: path.relative(output, file).replaceAll('\\', '/'),
    sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  }))
  plugins.push({ id: entry.id, target: entry.target, files })
  console.log(`${entry.id}: ${entry.package}/ (${entry.target})`)
}
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ plugins }, null, 2))

