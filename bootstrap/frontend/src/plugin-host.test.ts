import { describe, expect, it } from 'vitest'
import { readable } from '@sisyphus/sdk'
import { createLibrary, evaluate, evaluateArtifact, hostApi, installGlobals } from './host'
import type { AppPlugin, RuntimeControl, PluginLibraryEntry } from '@sisyphus/sdk'

const pluginFile = (id: string, body = '') => `sisyphus.define({
  id: '${id}',
  name: '${id}',
  plugin: {
    apply(ctx) { ${body} },
  },
})
`

/** Stands in for the profile: it records mounting so a test can read the story. */
function fakeRuntime() {
  const log: string[] = []
  const plugins = new Map<string, AppPlugin>()
  const runtime: RuntimeControl & { log: string[] } = {
    log,
    list: () =>
      [...plugins.entries()].map(([id, plugin]) => ({
        id,
        name: plugin.name ?? id,
        enabled: true,
        state: 'active' as const,
        requires: [],
        provides: [],
      })),
    subscribe: () => () => {},
    setEnabled: async () => {},
    add: async ({ id, plugin }) => {
      if (plugins.has(id)) throw new Error(`Duplicate plugin: ${id}`)
      plugins.set(id, plugin)
      log.push(`add:${id}`)
    },
    replace: async (id, plugin) => {
      plugins.set(id, plugin)
      log.push(`replace:${id}`)
    },
    unmount: async (id) => {
      if (!plugins.delete(id)) throw new Error(`Unknown plugin: ${id}`)
      log.push(`remove:${id}`)
    },
  }
  return runtime
}

/** A built artifact, shaped the way scripts/build-plugins.mjs writes one. */
const artifact = (
  id: string,
  exportName: string,
  body = '',
) => `var __sisyphusPlugin = (function (exports) {
  exports.${exportName} = { id: '${id}', name: '${id}', apply(ctx) { ${body} } };
  return exports;
})({});
SisyphusRuntime.register('${id}', __sisyphusPlugin);
`

/** A shipped artifact behind the bridge: a code file, a stylesheet, and its build metadata. */
interface Artifact {
  source: string
  original: string
  css?: string
  export?: string
  needs?: string[]
  order?: number
}

/** Stands in for the native half: a folder of files behind the bridge. */
function bridge(
  files: Record<string, string>,
  others: PluginLibraryEntry[] = [],
  artifacts: Record<string, Artifact> = {},
  reloadOnSave = false,
) {
  const listeners = new Set<(value: unknown) => void>()
  return {
    call: async <T>(method: string, input?: unknown): Promise<T> => {
      const {
        id = '',
        target,
        source,
      } = (input ?? {}) as {
        id?: string
        target?: string
        source?: string
      }
      if (method === 'plugins.catalog')
        return {
          folder: '/plugins',
          watching: true,
          reloadOnSave,
          plugins: [
            ...Object.keys(files).map((name) => ({
              id: name,
              target: 'renderer' as const,
              file: `${name}.renderer.js`,
            })),
            ...Object.entries(artifacts).map(([name, entry]) => ({
              id: name,
              target: 'renderer' as const,
              file: `${name}.renderer.js`,
              order: entry.order,
              export: entry.export,
              needs: entry.needs,
              css: entry.css ? `${name}.renderer.css` : null,
              shipped: true,
              edited: entry.source !== entry.original,
            })),
            ...others,
          ],
        } as T
      if ((method === 'plugins.read' || method === 'plugins.render') && target === 'renderer') {
        if (id in artifacts)
          return {
            source: artifacts[id].source,
            css: artifacts[id].css,
            file: `${id}.renderer.js`,
          } as T
        if (!(id in files)) throw new Error(`Unknown plugin: ${id}`)
        return { source: files[id], file: `${id}.renderer.js` } as T
      }
      if (method === 'plugins.restore') {
        if (!(id in artifacts)) throw new Error(`${id} is not a plugin this build shipped.`)
        artifacts[id].source = artifacts[id].original
        return undefined as T
      }
      if (method === 'plugins.write' && source !== undefined) {
        files[id] = source
        return undefined as T
      }
      if (method === 'plugins.remove') {
        delete files[id]
        return undefined as T
      }
      if (method === 'plugins.reloadOnSave') {
        reloadOnSave = Boolean((input as { reloadOnSave?: boolean })?.reloadOnSave)
        return undefined as T
      }
      if (method === 'plugins.watch' || method === 'plugins.reload') return undefined as T
      throw new Error(`Unexpected method: ${method}`)
    },
    on: <T>(_event: string, listener: (value: T) => void) => {
      const entry = listener as (value: unknown) => void
      listeners.add(entry)
      return () => {
        listeners.delete(entry)
      }
    },
    announce: (reload: string[] = []) => {
      for (const listener of listeners) listener({ reload })
    },
  }
}

describe('a plugin file the person wrote', () => {
  it('is run and hands back the plugin it defines', () => {
    const plugin = evaluate(pluginFile('user.notes'), 'user.notes')
    expect(plugin.id).toBe('user.notes')
    expect(plugin.name).toBe('user.notes')
    expect(typeof plugin.apply).toBe('function')
  })

  it('gets react, the service names, and an icon, and nothing else', () => {
    const api = hostApi()
    expect(typeof api.react.createElement).toBe('function')
    expect(api.sdk.panels).toBe('ui.panels.v1')
    expect(api.icons.plugin.startsWith('data:image/svg+xml')).toBe(true)
    // A file has one parameter; an unknown name is not quietly available.
    expect(() => evaluate('sisyphus.define(unknownThing)', 'user.notes')).toThrow(ReferenceError)
  })

  it('is told exactly what is wrong with it', () => {
    expect(() => evaluate('', 'user.notes')).toThrow(/must call sisyphus\.define/)
    expect(() => evaluate('sisyphus.define({}); sisyphus.define({})', 'user.notes')).toThrow(
      /2 times/,
    )
    expect(() => evaluate('sisyphus.define(42)', 'user.notes')).toThrow(/not an object/)
    expect(() => evaluate(pluginFile('user.other'), 'user.notes')).toThrow(
      /the file name is the id/,
    )
    expect(() => evaluate("sisyphus.define({ id: 'user.notes' })", 'user.notes')).toThrow(
      /apply\(context\)/,
    )
    expect(() => evaluate('throw new Error("boom")', 'user.notes')).toThrow(/boom/)
  })
})

describe('the renderer host', () => {
  it('applies explicit backend reloads while ordinary announcements remain pending', async () => {
    const files = { 'user.notes': pluginFile('user.notes'), 'user.other': pluginFile('user.other') }
    const runtime = fakeRuntime()
    const api = bridge(files)
    const host = createLibrary({ runtime, call: api.call, on: api.on })
    await host.refresh()
    files['user.notes'] = pluginFile('user.notes', 'void 1')
    files['user.other'] = pluginFile('user.other', 'void 2')
    api.announce()
    await host.refresh()
    expect(runtime.log.filter(item => item.startsWith('replace:'))).toEqual([])
    api.announce(['user.notes'])
    await host.refresh()
    expect(runtime.log.filter(item => item.startsWith('replace:'))).toEqual(['replace:user.notes'])
    expect(host.getSnapshot().plugins.find(item => item.id === 'user.other')?.pending).toBe(true)
    api.announce(['*'])
    await host.refresh()
    expect(runtime.log).toContain('replace:user.other')
    host.dispose()
  })

  // No panel is on screen in these tests on purpose: the host has to follow the
  // folder on its own, or a renderer plugin would not mount until someone looked.
  it('mounts what it finds, waits for an edit, and unmounts a deleted one', async () => {
    const files: Record<string, string> = { 'user.notes': pluginFile('user.notes') }
    const runtime = fakeRuntime()
    const api = bridge(files)
    const host = createLibrary({ runtime, call: api.call, on: api.on })
    await host.refresh()

    expect(runtime.log).toEqual(['add:user.notes'])
    expect(host.getSnapshot().folder).toBe('/plugins')
    expect(host.getSnapshot().plugins.map((entry) => entry.id)).toEqual(['user.notes'])

    // Nothing changed, so nothing is re-evaluated.
    await host.refresh()
    expect(runtime.log).toEqual(['add:user.notes'])

    // An edit that arrived from outside the app is noticed and reported, and the
    // code that works keeps running until a reload asks for the new one.
    files['user.notes'] = pluginFile('user.notes', 'ctx.provide("notes", 2)')
    await host.refresh()
    expect(runtime.log).toEqual(['add:user.notes'])
    expect(host.getSnapshot().plugins[0].pending).toBe(true)

    await host.reload('user.notes', 'renderer')
    expect(runtime.log).toEqual(['add:user.notes', 'replace:user.notes'])
    expect(host.getSnapshot().plugins[0].pending).toBe(false)

    delete files['user.notes']
    await host.refresh()
    expect(runtime.log).toEqual(['add:user.notes', 'replace:user.notes', 'remove:user.notes'])
    expect(host.getSnapshot().plugins).toEqual([])
  })

  it('mounts an edit on the spot when reload on save is on', async () => {
    const files: Record<string, string> = { 'user.notes': pluginFile('user.notes') }
    const runtime = fakeRuntime()
    const api = bridge(files, [], {}, true)
    const host = createLibrary({ runtime, call: api.call, on: api.on })
    await host.refresh()
    expect(host.getSnapshot().reloadOnSave).toBe(true)

    files['user.notes'] = pluginFile('user.notes', 'ctx.provide("notes", 2)')
    await host.refresh()
    expect(runtime.log).toEqual(['add:user.notes', 'replace:user.notes'])
    expect(host.getSnapshot().plugins[0].pending).toBe(false)
  })

  it('leaves the code that works in place when a reload brings an edit that does not load', async () => {
    const files: Record<string, string> = { 'user.notes': pluginFile('user.notes') }
    const runtime = fakeRuntime()
    const api = bridge(files)
    const host = createLibrary({ runtime, call: api.call, on: api.on })
    await host.refresh()

    files['user.notes'] = "sisyphus.define({ id: 'user.notes' })"
    await host.refresh()
    expect(host.getSnapshot().plugins[0].pending).toBe(true)
    expect(host.getSnapshot().plugins[0].error).toBeUndefined()

    // A reload on demand reports the problem rather than throwing at the app, and
    // the code that already works is never unmounted.
    await host.reload('user.notes', 'renderer')
    expect(host.getSnapshot().error).toBeUndefined()
    expect(host.getSnapshot().plugins[0].error).toMatch(/apply\(context\)/)
    expect(runtime.log).toEqual(['add:user.notes'])
  })

  it('follows the folder without being asked, and only mounts this process files', async () => {
    const files: Record<string, string> = { 'user.notes': pluginFile('user.notes') }
    const runtime = fakeRuntime()
    const api = bridge(files, [{ id: 'user.tool', target: 'main', file: 'user.tool.main.js' }])
    const host = createLibrary({ runtime, call: api.call, on: api.on })
    await host.refresh()

    expect(runtime.log).toEqual(['add:user.notes'])
    expect(host.getSnapshot().plugins.map((entry) => entry.id)).toEqual(['user.notes', 'user.tool'])

    files['user.extra'] = pluginFile('user.extra')
    api.announce()
    await host.refresh()
    expect(runtime.log).toContain('add:user.extra')
  })

  it('saves and removes through the native half', async () => {
    const files: Record<string, string> = { 'user.notes': pluginFile('user.notes') }
    const runtime = fakeRuntime()
    const api = bridge(files)
    const host = createLibrary({ runtime, call: api.call, on: api.on })
    await host.refresh()

    await host.save('user.notes', 'renderer', pluginFile('user.notes', 'return 1'))
    expect(runtime.log).toEqual(['add:user.notes', 'replace:user.notes'])

    await host.remove('user.notes', 'renderer')
    expect(runtime.log).toEqual(['add:user.notes', 'replace:user.notes', 'remove:user.notes'])

    // The file is gone, so a panel that still holds the old row gets a reason.
    await expect(host.read('user.notes', 'renderer')).rejects.toThrow(/Unknown plugin/)
  })

  it('reports a failure from the other process as the reason, not the wrapper', async () => {
    const host = createLibrary({
      runtime: fakeRuntime(),
      call: async () => {
        throw new Error(
          "Error invoking remote method 'sisyphus:call': Error: Not a toggleable desktop plugin",
        )
      },
      on: () => () => {},
    })
    await host.refresh()
    expect(host.getSnapshot().error).toBe('Not a toggleable desktop plugin')
    expect(readable(new Error('plain reason'))).toBe('plain reason')
  })
})

describe('a plugin artifact the build shipped', () => {
  it('is run with the window React and SDK, and hands back the export it declares', () => {
    installGlobals()
    const plugin = evaluateArtifact(
      artifact('feature.notes', 'notesPlugin'),
      'feature.notes',
      { export: 'notesPlugin' },
      {},
    )
    expect(plugin.id).toBe('feature.notes')
    expect(typeof plugin.apply).toBe('function')
  })

  it('takes what its package says it needs', () => {
    installGlobals()
    const source = `var __sisyphusPlugin = (function (exports) {
  exports.workspacePlugin = function (runtime, layout) {
    return { id: 'feature.workspace', name: 'Workspace', apply() {}, seen: [runtime, layout] };
  };
  return exports;
})({});
SisyphusRuntime.register('feature.workspace', __sisyphusPlugin);`
    const plugin = evaluateArtifact(
      source,
      'feature.workspace',
      { export: 'workspacePlugin', needs: ['runtime', 'layout'] },
      { runtime: 'the profile', layout: 'the layout' },
    ) as unknown as { seen: unknown[] }
    expect(plugin.seen).toEqual(['the profile', 'the layout'])
  })

  it('answers a CommonJS dependency with the window React, not a second copy', () => {
    installGlobals()
    // A dependency that ships as CommonJS reaches React through `require`; a bundle
    // with its own copy would break hooks the moment two plugins met in one tree.
    const source = `var __sisyphusPlugin = (function (exports) {
  var React = require('react');
  exports.notesPlugin = { id: 'feature.notes', name: 'notes', apply() {}, sameReact: React === SisyphusRuntime.react };
  return exports;
})({});
SisyphusRuntime.register('feature.notes', __sisyphusPlugin);`
    const plugin = evaluateArtifact(
      source,
      'feature.notes',
      { export: 'notesPlugin' },
      {},
    ) as unknown as { sameReact: boolean }
    expect(plugin.sameReact).toBe(true)
    expect(() => installGlobals().require('fs')).toThrow(/only provides React/)
  })

  it('is told what is wrong with it instead of failing quietly', () => {
    installGlobals()
    expect(() => evaluateArtifact('var nothing = 1', 'feature.notes', {}, {})).toThrow(
      /did not register/,
    )
    // A hand-written artifact may name its export anything, so one candidate is
    // taken as the plugin; several candidates and no match is a mistake worth saying.
    const plugin = evaluateArtifact(
      artifact('feature.notes', 'anythingAtAll'),
      'feature.notes',
      { export: 'other' },
      {},
    )
    expect(typeof plugin.apply).toBe('function')
    const ambiguous = `var __sisyphusPlugin = (function (exports) {
  exports.notes = { id: 'feature.notes', name: 'notes', apply() {} };
  exports.other = { id: 'feature.other', name: 'other', apply() {} };
  return exports;
})({});
SisyphusRuntime.register('feature.notes', __sisyphusPlugin);`
    expect(() => evaluateArtifact(ambiguous, 'feature.notes', { export: 'missing' }, {})).toThrow(
      /does not export/,
    )
    expect(() =>
      evaluateArtifact("SisyphusRuntime.register('feature.notes', 5)", 'feature.notes', {}, {}),
    ).toThrow(/not a plugin/)
    expect(() => evaluateArtifact('throw new Error("boom")', 'feature.notes', {}, {})).toThrow(
      /could not be loaded: boom/,
    )
  })

  it('mounts from the folder, waits for an edit, and restores the shipped copy', async () => {
    installGlobals()
    const running = artifact('feature.notes', 'notesPlugin')
    const artifacts: Record<string, Artifact> = {
      'feature.notes': {
        source: running,
        original: running,
        css: '.notes{}',
        export: 'notesPlugin',
        order: 3,
      },
    }
    const runtime = fakeRuntime()
    const api = bridge({}, [], artifacts)
    const host = createLibrary({ runtime, call: api.call, on: api.on })
    await host.refresh()
    expect(runtime.log).toEqual(['add:feature.notes'])

    // The studio (or an agent) edits the file: the window notices, and mounts it
    // when a reload asks for it.
    artifacts['feature.notes'].source = artifact(
      'feature.notes',
      'notesPlugin',
      'ctx.provide("n", 2)',
    )
    await host.refresh()
    expect(runtime.log).toEqual(['add:feature.notes'])
    expect(host.getSnapshot().plugins[0].pending).toBe(true)
    expect(host.getSnapshot().plugins[0].edited).toBe(true)

    await host.reload('feature.notes', 'renderer')
    expect(runtime.log).toEqual(['add:feature.notes', 'replace:feature.notes'])
    expect(host.getSnapshot().plugins[0].pending).toBe(false)

    // Restore goes through the native half and puts the built copy back in place.
    await host.restore('feature.notes', 'renderer')
    expect(runtime.log).toEqual([
      'add:feature.notes',
      'replace:feature.notes',
      'replace:feature.notes',
    ])
    expect(host.getSnapshot().plugins[0].edited).toBe(false)
  })
})
