'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')
const { findVSCode } = require('./vscode-launcher.js')

function text(value, name, required = false) {
  if (
    typeof value !== 'string' ||
    value.length > 4096 ||
    value.includes('\0') ||
    (required && !value.trim())
  )
    throw new Error(`Invalid ${name}`)
  return value
}
function strings(values, name) {
  if (!Array.isArray(values) || values.length > 64) throw new Error(`Invalid ${name}`)
  values.forEach((value) => text(value, name))
}
function checkedURL(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Use an HTTP or HTTPS address without embedded credentials')
  return url.toString()
}
function target(value) {
  text(value, 'target', true)
  if (/^https?:/i.test(value)) return checkedURL(value)
  if (!path.isAbsolute(value))
    throw new Error('Choose an absolute file or folder path, or an HTTP/HTTPS address')
  if (!fs.existsSync(value)) throw new Error(`Target does not exist: ${value}`)
  return value
}

const { processRun } = require('../../../scripts/backend/lib/process-run.js')

function localActions({ shell, integrations, spawnProcess = spawn }) {
  const actions = {}
  const add = (type, runner) => {
    actions[type] = runner
  }
  add('open', {
    icon: '↗',
    outputs: [
      { key: 'targets', label: 'Opened targets', kind: 'lines' },
      { key: 'count', label: 'Count', kind: 'number' },
    ],
    name: 'Open',
    description: 'Open projects, files, folders, or a set of pages.',
    defaults: {
      targets: [],
      application: 'default',
      program: '',
      args: [],
      profile: '',
      window: 'new',
    },
    fields: [
      {
        key: 'targets',
        label: 'Files, folders or websites',
        kind: 'targets',
        hint: 'One file, folder, workspace, or web address per line.',
      },
      {
        key: 'application',
        label: 'Open with',
        kind: 'select',
        options: [
          { value: 'default', label: 'System default' },
          { value: 'editor', label: 'Code editor' },
          { value: 'custom', label: 'Other application' },
        ],
      },
      {
        key: 'program',
        label: 'Application executable',
        kind: 'file',
        when: { key: 'application', value: 'custom' },
      },
      {
        key: 'args',
        label: 'Application arguments',
        kind: 'lines',
        hint: 'One argument per line; targets are appended.',
        when: { key: 'application', value: 'custom' },
      },
      {
        key: 'window',
        label: 'Window',
        kind: 'select',
        options: [
          { value: 'new', label: 'New window' },
          { value: 'reuse', label: 'Reuse window' },
        ],
        when: { key: 'application', value: 'editor' },
      },
      {
        key: 'profile',
        label: 'Editor profile',
        kind: 'text',
        when: { key: 'application', value: 'editor' },
      },
    ],
    validate(config) {
      strings(config.targets, 'targets')
      if (!config.targets.length) throw new Error('Add at least one target to Open')
      if (!['default', 'editor', 'custom'].includes(config.application))
        throw new Error('Choose an application')
      config.targets.forEach((value) => {
        text(value, 'target', true)
        if (/^https?:/i.test(value)) checkedURL(value)
        else if (!path.isAbsolute(value))
          throw new Error('Targets need an absolute path or web address')
      })
      if (config.application === 'custom') {
        text(config.program, 'application', true)
        strings(config.args ?? [], 'arguments')
      }
      if (config.profile !== undefined) text(config.profile, 'profile')
    },
    async execute(config, context) {
      const targets = config.targets.map(target)
      if (config.application === 'editor') {
        if (targets.every((value) => path.isAbsolute(value) && fs.statSync(value).isDirectory())) {
          await integrations.launch('vscode', {
            folders: targets,
            profile: config.profile,
            window: config.window,
            context: { id: `${context.flow.id}-${context.node.id}` },
          })
        } else {
          const program = findVSCode()
          if (!program)
            throw new Error('The code editor is unavailable; choose another application')
          const args = [config.window === 'reuse' ? '--reuse-window' : '--new-window']
          if (config.profile) args.push('--profile', config.profile)
          await processRun(
            { program, args: [...args, ...targets], detach: true },
            context,
            spawnProcess,
          )
        }
      } else if (config.application === 'custom') {
        await processRun(
          { program: config.program, args: [...(config.args ?? []), ...targets], detach: true },
          context,
          spawnProcess,
        )
      } else {
        for (const value of targets) {
          if (context.signal.aborted) throw new Error('Cancelled')
          if (/^https?:/i.test(value)) await shell.openExternal(value)
          else {
            const problem = await shell.openPath(value)
            if (problem) throw new Error(problem)
          }
        }
      }
      context.log(`Opened ${targets.length} ${targets.length === 1 ? 'target' : 'targets'}.\n`)
      return { targets, count: targets.length }
    },
  })
  add('run', {
    icon: '▷',
    outputs: [
      { key: 'stdout', label: 'Standard output', kind: 'text' },
      { key: 'stderr', label: 'Error output', kind: 'text' },
      { key: 'exitCode', label: 'Exit code', kind: 'number' },
    ],
    name: 'Run',
    description: 'Run a program or script with saved arguments.',
    defaults: { program: '', args: [], cwd: '', detach: false, timeoutSeconds: 300 },
    fields: [
      {
        key: 'program',
        label: 'Program or interpreter',
        kind: 'file',
        hint: 'For example: python, powershell.exe, or an executable path.',
      },
      {
        key: 'args',
        label: 'Arguments',
        kind: 'lines',
        hint: 'One argument per line, without surrounding quotes. Put the script path here.',
      },
      { key: 'cwd', label: 'Working folder', kind: 'folder' },
      {
        key: 'detach',
        label: 'Continue once the program starts',
        kind: 'boolean',
        hint: 'Useful for servers. Add Wait to check when they are ready. Detached programs remain open after cancellation.',
      },
      { key: 'timeoutSeconds', label: 'Timeout in seconds', kind: 'number', min: 1, max: 86400 },
    ],
    validate(config) {
      text(config.program, 'program', true)
      strings(config.args ?? [], 'arguments')
      text(config.cwd ?? '', 'working folder')
      if (config.cwd && !path.isAbsolute(config.cwd))
        throw new Error('Working folder must be an absolute path')
      if (config.detach !== undefined && typeof config.detach !== 'boolean')
        throw new Error('Invalid launch mode')
      if (
        !Number.isFinite(config.timeoutSeconds) ||
        config.timeoutSeconds < 1 ||
        config.timeoutSeconds > 86400
      )
        throw new Error('Timeout must be between 1 and 86,400 seconds')
    },
    execute: (config, context) => processRun(config, context, spawnProcess),
  })
  add('wait', {
    icon: '◷',
    outputs: [{ key: 'ready', label: 'Ready', kind: 'boolean' }],
    name: 'Wait',
    description: 'Pause briefly, or wait for a web service to respond.',
    defaults: { mode: 'duration', seconds: 1, url: '', timeoutSeconds: 60 },
    fields: [
      {
        key: 'mode',
        label: 'Wait for',
        kind: 'select',
        options: [
          { value: 'duration', label: 'A duration' },
          { value: 'url', label: 'A web service' },
        ],
      },
      {
        key: 'seconds',
        label: 'Seconds',
        kind: 'number',
        min: 0,
        max: 86400,
        when: { key: 'mode', value: 'duration' },
      },
      { key: 'url', label: 'Service address', kind: 'text', when: { key: 'mode', value: 'url' } },
      {
        key: 'timeoutSeconds',
        label: 'Timeout in seconds',
        kind: 'number',
        min: 1,
        max: 86400,
        when: { key: 'mode', value: 'url' },
      },
    ],
    validate(config) {
      if (!['duration', 'url'].includes(config.mode)) throw new Error('Choose what to wait for')
      if (config.mode === 'url') {
        checkedURL(config.url)
        if (
          !Number.isFinite(config.timeoutSeconds) ||
          config.timeoutSeconds < 1 ||
          config.timeoutSeconds > 86400
        )
          throw new Error('Choose a service timeout between 1 and 86,400 seconds')
      } else if (!Number.isFinite(config.seconds) || config.seconds < 0 || config.seconds > 86400)
        throw new Error('Choose a duration between 0 and 86,400 seconds')
    },
    async execute(config, { signal, log }) {
      if (config.mode === 'duration') {
        await delay(config.seconds * 1000, undefined, { signal })
        log(`Waited ${config.seconds} seconds.\n`)
        return { ready: true }
      }
      const deadline = Date.now() + config.timeoutSeconds * 1000
      while (Date.now() < deadline) {
        signal.throwIfAborted()
        try {
          const response = await fetch(config.url, {
            signal: AbortSignal.any([
              signal,
              AbortSignal.timeout(Math.min(3000, deadline - Date.now())),
            ]),
          })
          await response.body?.cancel()
          if (response.ok) {
            log('Service is ready.\n')
            return { ready: true }
          }
        } catch {
          signal.throwIfAborted()
        }
        await delay(Math.min(500, Math.max(0, deadline - Date.now())), undefined, { signal })
      }
      throw new Error('The service did not become ready before the timeout')
    },
  })
  actions.websites = {
    name: 'Open websites',
    description: 'Open a saved list of browser tabs.',
    defaults: { websites: [] },
    fields: [
      {
        key: 'websites',
        label: 'Websites',
        kind: 'lines',
        expose: true,
        hint: 'One address per line.',
      },
    ],
    outputs: [
      { key: 'websites', label: 'Websites', kind: 'lines' },
      { key: 'count', label: 'Count', kind: 'number' },
    ],
    validate(input) {
      strings(input.websites, 'websites')
      if (!input.websites.length) throw new Error('Add a website')
      input.websites.forEach(checkedURL)
    },
    async execute(input, context) {
      for (const website of input.websites) {
        context.signal.throwIfAborted()
        await shell.openExternal(checkedURL(website))
      }
      return { websites: input.websites, count: input.websites.length }
    },
  }
  return actions
}
function registerBuiltins(automations, dependencies) {
  const actions = localActions(dependencies)
  for (const [id, action] of Object.entries(actions)) action.aliases = [id]
  return automations.actions.registerService('system', { name: 'This computer', actions })
}
module.exports = { registerBuiltins, localActions, processRun, checkedURL }
