import { describe, expect, it, vi } from 'vitest'
import { Profile } from '@sisyphus/profile'
import {
  services,
  type ChatConfig,
  type Desktop,
  type Settings,
  type SettingsSection,
} from '@sisyphus/sdk'
import { createSettings, searchSections } from '../../../plugins/settings/frontend/registry'
import { createChatSettings } from '../../../plugins/settings/frontend/chat-store'

const section = (id: string, title = id): SettingsSection => ({
  id,
  title,
  category: 'Example',
  description: 'Font and text size',
  keywords: ['zoom'],
  component: () => null,
})

describe('settings contributions', () => {
  it('keeps snapshots stable, orders sections, and removes only the registration owner', () => {
    const registry = createSettings()
    const notify = vi.fn()
    const off = registry.subscribe(notify)
    const remove = registry.register(section('example.b', 'B'))
    registry.register({ ...section('example.first'), order: 1 })
    registry.register(section('example.a', 'A'))
    expect(registry.getSnapshot().map((item) => item.id)).toEqual([
      'example.first',
      'example.a',
      'example.b',
    ])
    const snapshot = registry.getSnapshot()
    expect(registry.getSnapshot()).toBe(snapshot)
    expect(() => registry.register(section('example.b'))).toThrow('Duplicate')
    remove()
    const replacement = section('example.b', 'Replacement')
    registry.register(replacement)
    remove()
    expect(registry.getSnapshot()).toContain(replacement)
    expect(notify).toHaveBeenCalledTimes(5)
    off()
    registry.register(section('example.c'))
    expect(notify).toHaveBeenCalledTimes(5)
  })

  it('searches contributed labels, categories, descriptions, and keywords using every query word', () => {
    const sections = [
      section('example.font', 'Display'),
      {
        ...section('example.api', 'Providers'),
        category: 'Chat',
        description: 'API keys',
        keywords: ['baseURL'],
      },
    ]
    expect(searchSections(sections, '  EXAMPLE zoom  ')).toEqual([sections[0]])
    expect(searchSections(sections, 'font size')).toEqual([sections[0]])
    expect(searchSections(sections, 'chat key baseurl')).toEqual([sections[1]])
    expect(searchSections(sections, 'zoom key')).toEqual([])
    expect(searchSections(sections, ' ')).toEqual(sections)
  })

  it('withdraws and restores external sections through the real plugin lifecycle', async () => {
    const registry = createSettings()
    const runtime = new Profile()
    await runtime.add({
      id: 'settings',
      plugin: {
        provide: [services.settings],
        apply(ctx) {
          ctx.provide(services.settings, registry)
        },
      },
    })
    const contributor = (title: string) => ({
      inject: [services.settings],
      apply(ctx: { get(id: string): unknown; effect(work: () => () => void): void }) {
        const settings = ctx.get(services.settings) as Settings
        ctx.effect(() => settings.register(section('example.display', title)))
      },
    })
    await runtime.add({ id: 'example', plugin: contributor('First') })
    expect(registry.getSnapshot()[0].title).toBe('First')
    await runtime.replace('example', contributor('Updated'))
    expect(registry.getSnapshot()).toHaveLength(1)
    expect(registry.getSnapshot()[0].title).toBe('Updated')
    await runtime.setEnabled('example', false)
    expect(registry.getSnapshot()).toEqual([])
    await runtime.setEnabled('example', true)
    expect(registry.getSnapshot()).toHaveLength(1)
    await runtime.dispose()
    expect(registry.getSnapshot()).toEqual([])
  })
})

const limits = { maxSteps: 0, maxRetries: 1, firstChunkSeconds: 0, chunkSeconds: 0, toolSeconds: 0 }
const config: ChatConfig = {
  baseURL: 'http://localhost:1234/v1',
  model: 'test',
  systemPrompt: 'Instructions',
  defaultSystemPrompt: 'Default',
  access: 'none',
  limits,
  defaultLimits: limits,
  compaction: { enabled: true, contextTokens: 32000 },
  harness: 'vercel-ai',
  harnesses: [{ id: 'vercel-ai', name: 'Vercel AI SDK', description: 'Default harness.' }],
  hasApiKey: false,
}
function desktopWith(call: (method: string, input?: unknown) => Promise<unknown>): Desktop {
  return {
    call: call as Desktop['call'],
    on: () => () => {},
    dropFiles: async () => {
      throw new Error('unused')
    },
  }
}
const defaultCall = async (method: string) => {
  if (method === 'chat.config.get' || method === 'chat.config.reload') return { ...config }
  if (method === 'chat.providers.get') return { text: '{"providers":[]}' }
  if (method === 'chat.tools')
    return [{ name: 'read_file', description: 'Read a file', access: 'read' }]
  throw new Error(`Unexpected method: ${method}`)
}

describe('chat settings state', () => {
  it('loads resources once and keeps provider failures separate from config and tools', async () => {
    const call = vi.fn(async (method: string) => {
      if (method === 'chat.providers.get') throw new Error('Provider file unavailable')
      return defaultCall(method)
    })
    const store = createChatSettings(desktopWith(call))
    await Promise.all([store.load(), store.load()])
    expect(call).toHaveBeenCalledTimes(3)
    expect(store.getSnapshot()).toMatchObject({
      loading: false,
      config,
      error: '',
      providerError: 'Provider file unavailable',
      providerLoading: false,
      toolsLoading: false,
    })
    expect(store.getSnapshot().tools).toHaveLength(1)
  })

  it('keeps general drafts when saving providers and only sends editable fields on save', async () => {
    const call = vi.fn(async (method: string, input?: unknown) => {
      if (method === 'chat.providers.save') return { ...config, provider: 'new-provider' }
      if (method === 'chat.config.save')
        return { ...config, ...(input as object), provider: 'new-provider' }
      return defaultCall(method)
    })
    const store = createChatSettings(desktopWith(call))
    await store.load()
    store.edit({ systemPrompt: 'Unsaved instructions', access: 'read' })
    store.setProviderText('{"providers":[{"id":"example"}]}')
    await store.saveProviders()
    expect(store.getSnapshot()).toMatchObject({
      dirty: true,
      config: { systemPrompt: 'Unsaved instructions', access: 'read', provider: 'new-provider' },
      providerSavedText: store.getSnapshot().providerText,
    })
    await store.save()
    expect(call).toHaveBeenCalledWith('chat.config.save', {
      systemPrompt: 'Unsaved instructions',
      access: 'read',
      limits,
      compaction: config.compaction,
      harness: 'vercel-ai',
    })
    expect(store.getSnapshot().dirty).toBe(false)
    store.edit({ access: 'write' })
    store.discard()
    expect(store.getSnapshot().config?.access).toBe('read')
  })

  it('preserves edits made while a save is in flight', async () => {
    let complete!: (value: ChatConfig) => void
    const store = createChatSettings(
      desktopWith(async (method) =>
        method === 'chat.config.save'
          ? new Promise<ChatConfig>((resolve) => {
              complete = resolve
            })
          : defaultCall(method),
      ),
    )
    await store.load()
    store.edit({ systemPrompt: 'First edit' })
    const saving = store.save()
    store.edit({ systemPrompt: 'Newer edit' })
    complete({ ...config, systemPrompt: 'First edit' })
    await saving
    expect(store.getSnapshot()).toMatchObject({
      dirty: true,
      saving: false,
      config: { systemPrompt: 'Newer edit' },
    })
    store.discard()
    expect(store.getSnapshot().config?.systemPrompt).toBe('First edit')
  })

  it('keeps failed saves dirty and allows retry', async () => {
    let fail = true
    const store = createChatSettings(
      desktopWith(async (method, input) => {
        if (method === 'chat.config.save') {
          if (fail) throw new Error('Unable to save')
          return { ...config, ...(input as object) }
        }
        return defaultCall(method)
      }),
    )
    await store.load()
    store.edit({ systemPrompt: 'Changed' })
    await store.save()
    expect(store.getSnapshot()).toMatchObject({
      dirty: true,
      error: 'Unable to save',
      saving: false,
    })
    fail = false
    await store.save()
    expect(store.getSnapshot()).toMatchObject({
      dirty: false,
      error: '',
      message: 'Chat settings saved.',
    })
  })

  it('reloads provider metadata without dropping general drafts', async () => {
    const store = createChatSettings(desktopWith(defaultCall))
    await store.load()
    store.edit({ access: 'write' })
    await store.loadProviders(true)
    expect(store.getSnapshot()).toMatchObject({
      dirty: true,
      config: { access: 'write' },
      providerMessage: 'Provider file reloaded.',
    })
    store.discard()
    expect(store.getSnapshot().config?.access).toBe('none')
  })
})
