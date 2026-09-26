#!/usr/bin/env node
// The desktop app names every plugin package it ships, and electron-builder builds
// the installed node_modules from that list: a plugin's own third-party
// dependencies - a tiptap, an xterm, a dockview - reach the installer only because
// the plugin package is named in `bootstrap/backend/package.json`. Running from the
// checkout never needs it (the workspace glob links and hoists regardless), so a
// hand-maintained list fails quietly, and only in a shipped build.
//
// So the list is derived instead. Every folder under `plugins/` whose manifest
// carries a `sisyphus` block contributes the package name it declares, and the
// names come from the manifests rather than from this file, so the two cannot
// drift. `npm run build` regenerates it, which makes adding a package and building
// the whole job.
//
//   node scripts/plugin-deps.mjs            write the derived list
//   node scripts/plugin-deps.mjs --check    report drift and exit non-zero
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const source = path.join(root, 'plugins')
const target = path.join(root, 'bootstrap', 'backend', 'package.json')
// What one of our plugin packages is called. The app's own dependencies are the
// ones this does not match.
const PLUGIN = '@sisyphus/plugin-'

/** The package name a plugin folder claims, or null when the folder is not a plugin. */
function packageName(folder) {
  const manifest = path.join(source, folder, 'package.json')
  if (!fs.existsSync(manifest)) return null
  const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'))
  if (!pkg.sisyphus || typeof pkg.name !== 'string') return null
  return pkg.name
}

/** Every plugin package this checkout has, in the order a person reads them. */
function derived() {
  const names = []
  for (const entry of fs.readdirSync(source, { withFileTypes: true }))
    if (entry.isDirectory()) {
      const name = packageName(entry.name)
      if (name) names.push(name)
    }
  return [...new Set(names)].sort()
}

/** The dependencies with our plugin packages last, and everything else as it was. */
function withPlugins(dependencies) {
  const own = Object.entries(dependencies).filter(([name]) => !name.startsWith(PLUGIN))
  return Object.fromEntries([...own, ...derived().map((name) => [name, '*'])])
}

function read() {
  return JSON.parse(fs.readFileSync(target, 'utf8'))
}

/** Writes the manifest back exactly as authored, apart from the dependencies. */
function write(dependencies) {
  const pkg = read()
  pkg.dependencies = dependencies
  fs.writeFileSync(target, `${JSON.stringify(pkg, null, 2)}\n`)
}

function report(expected, actual) {
  const wanted = new Set(Object.keys(expected))
  const missing = [...wanted].filter((name) => !(name in actual))
  const stale = Object.keys(actual).filter((name) => name.startsWith(PLUGIN) && !wanted.has(name))
  for (const name of missing) console.error(`  need to add    ${name}`)
  for (const name of stale) console.error(`  no longer here ${name}`)
  if (!missing.length && !stale.length) console.error('  the same names, in a different order')
}

const pkg = read()
const expected = withPlugins(pkg.dependencies)

if (process.argv.includes('--check')) {
  // Key order is part of the comparison, so a hand edit is a drift too.
  if (JSON.stringify(expected) === JSON.stringify(pkg.dependencies)) {
    console.log(`  ${derived().length} plugin dependencies are in step with plugins/`)
  } else {
    console.error('  bootstrap/backend/package.json is out of step with plugins/:')
    report(expected, pkg.dependencies)
    console.error('\n  Run: npm run plugin-deps\n')
    process.exitCode = 1
  }
} else {
  write(expected)
  console.log(`  bootstrap/backend/package.json: ${derived().length} plugin dependencies`)
}
