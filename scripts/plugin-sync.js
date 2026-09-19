#!/usr/bin/env node
'use strict'
// Puts the build of `packages/plugin-*` into the app's plugins folder.
//
//   npm run plugins:build    build the artifacts from the packages
//   npm run plugins:sync     copy that build into the app's plugins folder
//   npm run plugins:watch    rebuild and copy whenever a package changes
//
//   --source <dir>   where the build is (default: build/plugins)
//   --dest <dir>     the app's plugins folder (default: this platform's app data)
//   --force          overwrite files edited in the app's folder
//   --dry-run        report what would happen, and change nothing
//
// The app performs this same copy by itself on startup, so a distribution needs no
// script; this is the developer's way to push a change into a *running* app. Reload
// on save is on by default, so a synced file is mounted as soon as it lands.
//
// A file edited in the app's folder is left alone unless --force is given: the app's
// copy is the copy the app runs, and losing an edit to a sync would be the wrong
// surprise.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { PluginArtifacts } = require('../apps/desktop/lib/plugin-artifacts')

const ROOT = path.join(__dirname, '..')
const BUILD = path.join(ROOT, 'build', 'plugins')
const USAGE = `Copy the build of packages/plugin-* into the app's plugins folder.

  --source <dir>   where the build is (default: build/plugins)
  --dest <dir>     the app's plugins folder (default: this platform's app data)
  --force          overwrite files edited in the app's folder
  --watch          rebuild and copy on every change
  --dry-run        report what would happen, and change nothing
  --help
`

/** Where the desktop app keeps its plugins, for a script run outside Electron. */
function defaultFolder() {
  if (process.env.SISYPHUS_USER_DATA) return path.join(process.env.SISYPHUS_USER_DATA, 'plugins')
  if (process.platform === 'win32' && process.env.APPDATA)
    return path.join(process.env.APPDATA, 'Sisyphus', 'plugins')
  if (process.platform === 'darwin')
    return path.join(os.homedir(), 'Library', 'Application Support', 'Sisyphus', 'plugins')
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
    'Sisyphus',
    'plugins',
  )
}

function options(argv) {
  const value = (index, flag) => {
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) throw new Error(`${flag} needs a folder`)
    return path.resolve(next)
  }
  const parsed = {
    source: BUILD,
    destination: defaultFolder(),
    watch: false,
    force: false,
    dryRun: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--help' || flag === '-h') return { help: true }
    else if (flag === '--source') parsed.source = value(index++, flag)
    else if (flag === '--dest') parsed.destination = value(index++, flag)
    else if (flag === '--watch') parsed.watch = true
    else if (flag === '--force') parsed.force = true
    else if (flag === '--dry-run') parsed.dryRun = true
    else throw new Error(`Unknown flag: ${flag}`)
  }
  return parsed
}

const list = (names) => (names.length ? names.join(', ') : '-')

function copy(parsed) {
  const artifacts = new PluginArtifacts({
    shippedDir: parsed.source,
    directory: parsed.destination,
  })
  if (!artifacts.available)
    throw new Error(`No plugin build in ${parsed.source}; run plugins:build.`)
  if (parsed.dryRun) {
    const would = artifacts
      .files()
      .filter((name) => !fs.existsSync(path.join(parsed.destination, name)))
    console.log(`\n  ${parsed.source}  ->  ${parsed.destination}  (dry run)`)
    console.log(`    would copy  ${would.length}  ${list(would)}`)
    return
  }
  const result = artifacts.seed({ force: parsed.force })
  console.log(`\n  ${parsed.source}  ->  ${parsed.destination}`)
  console.log(`    copied      ${result.seeded.length}  ${list(result.seeded)}`)
  console.log(
    `    kept        ${result.kept.length}  ${list(result.kept)}  (edited in the app's folder)`,
  )
  console.log(`    removed     ${result.removed.length}  ${list(result.removed)}`)
  if (!result.seeded.length && !result.removed.length)
    console.log('    already in step; the app is running this build')
}

function rebuild() {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-plugins.mjs')], {
    stdio: 'inherit',
  })
  if (result.status !== 0) throw new Error('Build failed; the app keeps the plugins it has')
}

function main() {
  let parsed
  try {
    parsed = options(process.argv.slice(2))
  } catch (error) {
    console.error(`${error.message}\n\n${USAGE}`)
    process.exitCode = 1
    return
  }
  if (parsed.help) {
    console.log(USAGE)
    return
  }
  try {
    if (parsed.source === BUILD && !parsed.dryRun) rebuild()
    copy(parsed)
  } catch (error) {
    console.error(`  ${error.message}`)
    process.exitCode = 1
    return
  }
  if (!parsed.watch) return
  let timer
  const again = (work) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        work()
      } catch (error) {
        console.error(`  ${error.message}`)
      }
    }, 150)
  }
  // A change in the packages means the build is stale; a change in the build means
  // the app's folder is stale. Both end in the same copy.
  fs.watch(path.join(ROOT, 'plugins'), { recursive: true }, () =>
    again(() => {
      rebuild()
      copy(parsed)
    }),
  )
  console.log(`\n  watching plugins/; copying source to ${parsed.destination}`)
  console.log('  save a package and the running app reloads it. Ctrl+C to stop.\n')
}

main()
