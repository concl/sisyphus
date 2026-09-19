'use strict'
// Bridge to the official MCP filesystem server (MIT, from the MCP project).
// Tool metadata is declared statically so access levels and the Settings list
// stay stable, while execution runs against one cached server process per
// conversation folder — the server also jails every path to that folder.
const path = require('node:path')

const PACKAGE = '@modelcontextprotocol/server-filesystem'

function serverEntry() {
  return path.join(path.dirname(require.resolve(`${PACKAGE}/package.json`)), 'dist', 'index.js')
}

function textOf(result) {
  const parts = Array.isArray(result?.content)
    ? result.content.map((part) =>
        part?.type === 'text' ? part.text : `[${part?.type ?? 'unknown'} content]`,
      )
    : []
  return parts.join('\n').trim()
}

class FileBridge {
  constructor() {
    this.clients = new Map()
  }

  // Started on first use per folder and kept for the session.
  async start(folder) {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
    const transport = new StdioClientTransport({
      // The Electron binary doubles as Node when this flag is set, so the app
      // does not depend on a separate Node install.
      command: process.execPath,
      args: [serverEntry(), folder],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      // No cwd: the server works from absolute paths, and a child process that
      // sits inside the folder would keep it locked on Windows.
      stderr: 'ignore',
    })
    const client = new Client({ name: 'sisyphus', version: '0.1.0' })
    await client.connect(transport)
    return client
  }

  async client(folder) {
    const existing = this.clients.get(folder)
    if (existing) return existing
    const pending = this.start(folder)
    this.clients.set(folder, pending)
    try {
      return await pending
    } catch (error) {
      this.clients.delete(folder)
      throw error
    }
  }

  async call(folder, name, args) {
    const client = await this.client(folder)
    const result = await client.callTool({ name, arguments: args })
    const text = textOf(result)
    if (result?.isError) throw new Error(text || `${name} failed`)
    return text
  }

  async dispose() {
    const pending = [...this.clients.values()]
    this.clients.clear()
    await Promise.all(
      pending.map(async (entry) => {
        try {
          const client = await entry
          // A server that ignores the shutdown must not hold the app open.
          await Promise.race([
            client.close().catch(() => {}),
            new Promise((resolve) => {
              const timer = setTimeout(resolve, 2000)
              timer.unref?.()
            }),
          ])
        } catch {
          // A server that never started has nothing to close.
        }
      }),
    )
  }
}

module.exports = { FileBridge, serverEntry, PACKAGE }
