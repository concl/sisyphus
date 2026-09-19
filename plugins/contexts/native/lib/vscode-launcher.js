'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

function findVSCode({ platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return 'code'
  const candidates = [
    path.join(env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
    path.join(env.ProgramFiles || 'C:\\Program Files', 'Microsoft VS Code', 'Code.exe'),
    path.join(
      env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      'Microsoft VS Code',
      'Code.exe',
    ),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

function workspaceDocument(folders) {
  return {
    folders: folders.map((folder) => ({ name: path.basename(folder) || folder, path: folder })),
    settings: {},
    extensions: { recommendations: [] },
  }
}

function start(command, args, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

function createVSCodeLauncher({ userData, command = findVSCode(), spawnProcess } = {}) {
  const directory = path.join(userData, 'integrations', 'vscode')
  return {
    available: () => Boolean(command),
    async openContext({ context, folders, profile, window }) {
      if (!command) throw new Error('VS Code was not found. Install it in the standard location.')
      fs.mkdirSync(directory, { recursive: true })
      const workspace = path.join(directory, `${context.id}.code-workspace`)
      fs.writeFileSync(workspace, JSON.stringify(workspaceDocument(folders), null, 2))
      const args = [workspace, window === 'reuse' ? '--reuse-window' : '--new-window']
      if (profile) args.push('--profile', profile)
      await start(command, args, spawnProcess)
      return { integration: 'vscode', workspace }
    },
    async openFile({ file, line, column }) {
      if (!command) throw new Error('VS Code was not found. Install it in the standard location.')
      const location = line ? `${file}:${line}${column ? `:${column}` : ''}` : file
      await start(
        command,
        line ? ['--goto', location, '--reuse-window'] : [location, '--reuse-window'],
        spawnProcess,
      )
      return { integration: 'vscode', file }
    },
  }
}

module.exports = { createVSCodeLauncher, findVSCode, workspaceDocument }
