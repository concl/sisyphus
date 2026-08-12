'use strict'
// Terminal backend detection. Pure logic (no Electron) so it can be unit
// tested; main.js owns the result cache.
const { spawnSync, execFileSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const WINDOWS = process.platform === 'win32'

function commandExists(cmd) {
  try {
    const probe = WINDOWS ? 'where.exe' : 'which'
    return spawnSync(probe, [cmd], { stdio: 'ignore', windowsHide: true }).status === 0
  } catch {
    return false
  }
}

function findGitBash() {
  const candidates = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
  ]
  return candidates.find((p) => fs.existsSync(p)) || null
}

// Returns the default WSL distro name, or null when WSL is missing/unset.
function detectWslDistro() {
  try {
    const out = execFileSync('wsl.exe', ['-l', '-q'], {
      encoding: 'buffer',
      timeout: 4000,
      windowsHide: true,
    })
    // Old WSL builds output UTF-16LE; detect it by the NUL bytes.
    const text = out
      .toString(out.includes(0) ? 'utf16le' : 'utf8')
      .replace(/^\uFEFF/, '')
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    return lines[0] || null
  } catch {
    return null
  }
}

function detectBackends() {
  const backends = []
  let defaultId = null

  if (WINDOWS) {
    backends.push({
      id: 'powershell',
      name: 'PowerShell',
      command: 'powershell.exe',
      args: ['-NoLogo'],
    })
    if (commandExists('pwsh.exe')) {
      backends.push({ id: 'pwsh', name: 'PowerShell 7', command: 'pwsh.exe', args: ['-NoLogo'] })
    }
    backends.push({
      id: 'cmd',
      name: 'Command Prompt',
      command: process.env.COMSPEC || 'cmd.exe',
      args: [],
    })
    const gitBash = findGitBash()
    if (gitBash) {
      backends.push({ id: 'gitbash', name: 'Git Bash', command: gitBash, args: ['--login', '-i'] })
    }
    const distro = detectWslDistro()
    if (distro) {
      backends.push({ id: 'wsl', name: `WSL: ${distro}`, command: 'wsl.exe', args: ['-d', distro] })
    }
    // Windows PowerShell is the stock default shell on Windows.
    defaultId = 'powershell'
  } else {
    const shell = process.env.SHELL || (fs.existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash')
    const name = path.basename(shell)
    backends.push({ id: name, name: name[0].toUpperCase() + name.slice(1), command: shell, args: [] })
    defaultId = name
  }

  if (!backends.find((b) => b.id === defaultId)) defaultId = backends[0].id
  return { backends, defaultId }
}

module.exports = { detectBackends, commandExists, findGitBash, detectWslDistro }
