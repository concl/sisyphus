#!/usr/bin/env node
/**
 * A button for this checkout: a desktop entry that opens the app, and optionally the
 * same entry when you log in.
 *
 *   node scripts/shortcut.mjs                the entry, where this system keeps them
 *   node scripts/shortcut.mjs --menu         Windows: also in the Start menu
 *   node scripts/shortcut.mjs --startup      also run it at login
 *   node scripts/shortcut.mjs --print        say what would be written, write nothing
 *   node scripts/shortcut.mjs --remove       take the entries away again
 *   node scripts/shortcut.mjs --icon=FILE    use this icon (else the favicon)
 *   node scripts/shortcut.mjs --name=NAME    call it something else
 *
 * What it writes, per system:
 *   Windows  a .lnk on the Desktop (and in the Start menu with --menu)
 *   macOS    an .app bundle in ~/Applications, with an alias on the Desktop
 *   Linux    a .desktop file in ~/.local/share/applications, and on the Desktop
 * With --startup the same entry also goes where the system starts things at login.
 *
 * The entry points at the Electron binary this checkout installed and runs it with
 * `bootstrap/backend` as the working directory, which is exactly what `npm start` runs:
 * a click needs no Node on PATH, no terminal window, and no build each time. It
 * points into this checkout, so move the folder and run this again. A second click
 * while the app is running focuses it, because the app takes a single-instance lock.
 *
 * The app starts its own Python host (plugins/python/service) when a Python block asks a
 * service to run, so the entry does not need to start one; and nothing here builds the
 * app, except when there is no build to run at all.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appDir = path.join(base, 'bootstrap', 'backend')
const manifest = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'))
const require = createRequire(path.join(appDir, 'package.json'))
/** The Electron binary in this checkout's dependency tree, not one from the PATH. */
const electron = require('electron')

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const option = (name, fallback) => {
  const index = argv.findIndex((value) => value === `--${name}` || value.startsWith(`--${name}=`))
  if (index < 0) return fallback
  const value = argv[index]
  if (value.includes('=')) return value.slice(value.indexOf('=') + 1)
  return argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : fallback
}

const name = option('name', manifest.productName ?? manifest.name)
const remove = flag('remove')
const dryRun = flag('print')
const wantMenu = flag('menu')
const wantStartup = flag('startup')
const mayBuild = !flag('no-build')

const relative = (file) => path.relative(base, file) || file
const home = os.homedir()
/** Bundle identifier and login-agent label for the entries this writes. */
const label = 'sisyphus.checkout'

/**
 * The icon for the entry: the one you name, one already in `bootstrap/backend/build`, or the
 * app's own mark drawn from `bootstrap/frontend/public/favicon.svg`. Nothing in this
 * repository renders SVG, so that drawing is done once by the Electron in this
 * checkout and left in `bootstrap/backend/build`, where a packaged build looks too.
 */
function renderIcon() {
  const svg = path.join(base, 'bootstrap', 'frontend', 'public', 'favicon.svg')
  if (!fs.existsSync(svg)) return ''
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-icon-'))
  const script = path.join(folder, 'render.cjs')
  const png = path.join(appDir, 'build', 'icon.png')
  fs.writeFileSync(script, RENDER_ICON)
  console.log('Drawing an icon from bootstrap/frontend/public/favicon.svg')
  const result = spawnSync(electron, [script, svg, png], { stdio: 'inherit' })
  fs.rmSync(folder, { recursive: true, force: true })
  if (result.status !== 0 || !fs.existsSync(png)) return ''
  if (process.platform !== 'win32') return png
  // A shortcut on Windows wants an .ico: one PNG behind an ICO header is a valid one.
  const bytes = fs.readFileSync(png)
  const header = Buffer.alloc(22)
  header.writeUInt16LE(1, 2) // an icon, not a cursor
  header.writeUInt16LE(1, 4) // one image
  header.writeUInt16LE(1, 10) // colour planes
  header.writeUInt16LE(32, 12) // bits per pixel
  header.writeUInt32LE(bytes.length, 14)
  header.writeUInt32LE(22, 18) // the PNG follows the header and its one entry
  // Width and height stay zero, which is how an ICO spells 256.
  const ico = path.join(appDir, 'build', 'icon.ico')
  fs.writeFileSync(ico, Buffer.concat([header, bytes]))
  return ico
}

/** Runs under Electron: draws the SVG at 256px and writes a transparent PNG. */
const RENDER_ICON = `const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const [svgFile, outFile] = process.argv.slice(2)
const svg = fs.readFileSync(svgFile, 'utf8')
const page =
  '<body style="margin:0;background:transparent;width:256px;height:256px">' +
  '<img src="data:image/svg+xml;base64,' +
  Buffer.from(svg).toString('base64') +
  '" style="width:256px;height:245px;display:block">'
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 256,
    height: 256,
    show: false,
    frame: false,
    transparent: true,
  })
  await win.loadURL('data:text/html;base64,' + Buffer.from(page).toString('base64'))
  await new Promise((resolve) => setTimeout(resolve, 500))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 })
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, image.toPNG())
  app.exit(0)
})
`

function resolveIcon() {
  const given = option('icon', '')
  if (given) return path.resolve(given)
  const conventional = { win32: 'icon.ico', darwin: 'icon.icns' }[process.platform] ?? 'icon.png'
  const present = path.join(appDir, 'build', conventional)
  if (fs.existsSync(present)) return present
  if (dryRun) return ''
  const drawn = renderIcon()
  if (drawn) return drawn
  // Nothing drawn: a shortcut can take an executable's own icon, and a Linux entry can
  // take an SVG, which is the one image this repository does have.
  if (process.platform === 'win32') return electron
  const favicon = path.join(base, 'bootstrap', 'frontend', 'public', 'favicon.svg')
  return process.platform === 'linux' && fs.existsSync(favicon) ? favicon : ''
}

/**
 * Runs the build when there is nothing to run yet. A checkout that has been built
 * already is left alone: the entry is for opening the app, not for rebuilding it.
 */
function ensureSomethingToRun() {
  const missing = [
    path.join(base, 'build', 'plugins', 'manifest.json'),
    path.join(base, 'bootstrap', 'frontend', 'dist', 'index.html'),
  ].filter((file) => !fs.existsSync(file))
  if (!missing.length) return
  if (dryRun || !mayBuild)
    throw new Error(`nothing to run yet: ${missing.map(relative).join(', ')}; run npm run build`)
  console.log(`Nothing to run yet (${missing.map(relative).join(', ')}): building once.`)
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: base,
    stdio: 'inherit',
  })
  if (result.status !== 0) throw new Error('the build failed, so no entry was written')
}

// ---------------------------------------------------------------- Windows

const powershell = (script) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sisyphus-shortcut-'))
  const file = path.join(folder, 'entry.ps1')
  fs.writeFileSync(file, `$ErrorActionPreference = 'Stop'\n${script}\n`)
  try {
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file],
      { stdio: 'inherit' },
    )
    if (result.status !== 0) throw new Error('powershell could not write the entry')
  } finally {
    fs.rmSync(folder, { recursive: true, force: true })
  }
}
const single = (value) => `'${String(value).replaceAll("'", "''")}'`
const windowsFolder = (which) => {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `[Environment]::GetFolderPath('${which}')`],
    { encoding: 'utf8' },
  )
  const value = result.stdout.trim()
  if (!value) throw new Error(`could not find the ${which} folder`)
  return value
}

function windows(icon) {
  const desktop = path.join(windowsFolder('Desktop'), `${name}.lnk`)
  const entries = [desktop]
  if (wantMenu) entries.push(path.join(windowsFolder('Programs'), `${name}.lnk`))
  if (wantStartup) entries.push(path.join(windowsFolder('Startup'), `${name}.lnk`))
  if (!dryRun)
    powershell(`
$shell = New-Object -ComObject WScript.Shell
foreach ($file in @(${entries.map(single).join(', ')})) {
  $link = $shell.CreateShortcut($file)
  $link.TargetPath = ${single(electron)}
  $link.Arguments = '.'
  $link.WorkingDirectory = ${single(appDir)}
  ${icon ? `$link.IconLocation = ${single(`${icon},0`)}` : ''}
  $link.Description = ${single(`${name} - this checkout`)}
  $link.Save()
}`)
  return entries
}

function windowsRemove() {
  const possible = [
    path.join(windowsFolder('Desktop'), `${name}.lnk`),
    path.join(windowsFolder('Programs'), `${name}.lnk`),
    path.join(windowsFolder('Startup'), `${name}.lnk`),
  ]
  const found = possible.filter((file) => fs.existsSync(file))
  if (found.length && !dryRun)
    powershell(`foreach ($file in @(${found.map(single).join(', ')})) {
  Remove-Item -LiteralPath $file -Force
}`)
  return possible
}

// ---------------------------------------------------------------- macOS

const macBundle = () => path.join(home, 'Applications', `${name}.app`)

function mac(icon) {
  const bundle = macBundle()
  const script = path.join(bundle, 'Contents', 'MacOS', name)
  const alias = path.join(home, 'Desktop', `${name}.app`)
  const entries = [bundle, alias]
  if (dryRun) return entries
  fs.mkdirSync(path.dirname(script), { recursive: true })
  fs.writeFileSync(
    path.join(bundle, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${name}</string>
  <key>CFBundleDisplayName</key><string>${name}</string>
  <key>CFBundleIdentifier</key><string>${label}</string>
  <key>CFBundleExecutable</key><string>${name}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`,
  )
  // A bundle launches its executable with almost no PATH, so this walks into the
  // checkout's own Electron rather than looking for anything on the system.
  fs.writeFileSync(
    script,
    `#!/bin/sh
# ${name}: written by scripts/shortcut.mjs, points at ${relative(appDir)}
cd ${JSON.stringify(appDir)} || exit 1
exec ${JSON.stringify(electron)} .
`,
  )
  fs.chmodSync(script, 0o755)
  if (icon.endsWith('.icns')) {
    fs.mkdirSync(path.join(bundle, 'Contents', 'Resources'), { recursive: true })
    fs.copyFileSync(icon, path.join(bundle, 'Contents', 'Resources', 'icon.icns'))
  }
  if (!fs.existsSync(alias)) fs.symlinkSync(bundle, alias)
  if (wantStartup) {
    const agents = path.join(home, 'Library', 'LaunchAgents')
    fs.mkdirSync(agents, { recursive: true })
    fs.writeFileSync(
      path.join(agents, `${label}.plist`),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>${script}</string></array>
  <key>RunAtLoad</key><true/>
  <key>WorkingDirectory</key><string>${appDir}</string>
</dict>
</plist>
`,
    )
    entries.push(path.join(agents, `${label}.plist`))
  }
  return entries
}

function macRemove() {
  const agents = path.join(home, 'Library', 'LaunchAgents')
  const possible = [
    macBundle(),
    path.join(home, 'Desktop', `${name}.app`),
    path.join(agents, `${label}.plist`),
  ]
  if (!dryRun) for (const file of possible) fs.rmSync(file, { recursive: true, force: true })
  return possible
}

// ---------------------------------------------------------------- Linux

const desktopFile = (icon) => `[Desktop Entry]
Type=Application
Version=1.0
Name=${name}
Comment=Personal workspace (this checkout)
Exec=${JSON.stringify(electron)} .
Path=${appDir}
${icon ? `Icon=${icon}\n` : ''}Terminal=false
Categories=Development;Utility;
`

function linux(icon) {
  const applications = path.join(home, '.local', 'share', 'applications', `${name}.desktop`)
  const desktop = path.join(home, 'Desktop', `${name}.desktop`)
  const entries = [applications]
  if (fs.existsSync(path.join(home, 'Desktop'))) entries.push(desktop)
  if (wantStartup) entries.push(path.join(home, '.config', 'autostart', `${name}.desktop`))
  if (!dryRun)
    for (const file of entries) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, desktopFile(icon))
      // Some desktops will not offer a launcher that is not executable.
      fs.chmodSync(file, 0o755)
    }
  return entries
}

function linuxRemove() {
  const possible = [
    path.join(home, '.local', 'share', 'applications', `${name}.desktop`),
    path.join(home, 'Desktop', `${name}.desktop`),
    path.join(home, '.config', 'autostart', `${name}.desktop`),
  ]
  if (!dryRun) for (const file of possible) fs.rmSync(file, { force: true })
  return possible
}

// ---------------------------------------------------------------- the run

const PINS = {
  win32: 'right-click it, Show more options, Pin to taskbar',
  darwin: 'drag it from ~/Applications onto the Dock',
  linux: 'right-click it in the applications menu, Add to favorites',
}

function main() {
  if (!fs.existsSync(electron)) throw new Error(`no Electron in this checkout at ${electron}`)
  if (remove) {
    const entries =
      process.platform === 'win32'
        ? windowsRemove()
        : process.platform === 'darwin'
          ? macRemove()
          : linuxRemove()
    console.log(`${name}: entry removed`)
    for (const file of entries)
      console.log(`  ${fs.existsSync(file) ? 'still there' : 'gone'}  ${file}`)
    return
  }

  ensureSomethingToRun()
  const icon = resolveIcon()
  const entries =
    process.platform === 'win32'
      ? windows(icon)
      : process.platform === 'darwin'
        ? mac(icon)
        : linux(icon)
  console.log(`${name}${dryRun ? ' (nothing written: --print)' : ''}`)
  console.log(`  runs     "${electron}" .`)
  console.log(`  in       ${appDir}`)
  console.log(`  icon     ${icon || "the system's own"}`)
  for (const file of entries) console.log(`  entry    ${file}${dryRun ? '' : ''}`)
  if (process.platform in PINS) console.log(`  to pin   ${PINS[process.platform]}`)
  if (!wantStartup) console.log('  at login node scripts/shortcut.mjs --startup')
}

try {
  main()
} catch (error) {
  console.error(`shortcut: ${error.message}`)
  process.exitCode = 1
}
