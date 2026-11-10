import { readable, type ChatConfig, type Desktop } from '@sisyphus/sdk'

export interface Tool {
  name: string
  description: string
  access: string
}

interface ChatSettingsState {
  config: ChatConfig | null
  loading: boolean
  error: string
  saving: boolean
  dirty: boolean
  message: string
  providerText: string
  providerSavedText: string
  providerLoading: boolean
  providerSaving: boolean
  providerError: string
  providerMessage: string
  tools: Tool[]
  toolsError: string
  toolsLoading: boolean
}

function editable(config: ChatConfig) {
  return {
    systemPrompt: config.systemPrompt,
    access: config.access,
    limits: config.limits,
    compaction: config.compaction,
    harness: config.harness,
  }
}

/** Shared drafts survive navigation between Chat sections; each resource fails independently. */
export function createChatSettings(desktop: Desktop) {
  let saved: ChatConfig | null = null
  let loading: Promise<void> | undefined
  let state: ChatSettingsState = {
    config: null,
    loading: true,
    error: '',
    saving: false,
    dirty: false,
    message: '',
    providerText: '',
    providerSavedText: '',
    providerLoading: true,
    providerSaving: false,
    providerError: '',
    providerMessage: '',
    tools: [],
    toolsError: '',
    toolsLoading: true,
  }
  const listeners = new Set<() => void>()
  const update = (patch: Partial<ChatSettingsState>) => {
    state = { ...state, ...patch }
    state.dirty = Boolean(
      state.config &&
      saved &&
      JSON.stringify(editable(state.config)) !== JSON.stringify(editable(saved)),
    )
    listeners.forEach((listener) => listener())
  }
  const refreshMetadata = (config: ChatConfig) => {
    // Provider saves/reloads must not overwrite general settings that are being edited.
    saved = saved ? { ...config, ...editable(saved) } : config
    update({ config: state.config ? { ...config, ...editable(state.config) } : config })
  }
  const store = {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async loadConfig() {
      update({ loading: true, error: '' })
      try {
        const config = await desktop.call<ChatConfig>('chat.config.get')
        saved = config
        update({ config })
      } catch (error) {
        update({ error: readable(error) })
      } finally {
        update({ loading: false })
      }
    },
    async loadProviders(reload = false) {
      if (state.providerSaving || (reload && state.providerLoading)) return
      update({ providerLoading: true, providerError: '', providerMessage: '' })
      try {
        const document = await desktop.call<{ text: string }>('chat.providers.get')
        if (reload) refreshMetadata(await desktop.call<ChatConfig>('chat.config.reload'))
        update({
          providerText: document.text,
          providerSavedText: document.text,
          providerMessage: reload ? 'Provider file reloaded.' : '',
        })
      } catch (error) {
        update({ providerError: readable(error) })
      } finally {
        update({ providerLoading: false })
      }
    },
    async loadTools() {
      update({ toolsLoading: true, toolsError: '' })
      try {
        update({ tools: await desktop.call<Tool[]>('chat.tools') })
      } catch (error) {
        update({ toolsError: readable(error) })
      } finally {
        update({ toolsLoading: false })
      }
    },
    load() {
      loading ??= Promise.all([store.loadConfig(), store.loadProviders(), store.loadTools()]).then(
        () => {},
      )
      return loading
    },
    edit(
      patch: Partial<
        Pick<ChatConfig, 'systemPrompt' | 'access' | 'limits' | 'compaction' | 'harness'>
      >,
    ) {
      if (state.config) update({ config: { ...state.config, ...patch }, message: '', error: '' })
    },
    discard() {
      if (saved && state.config)
        update({ config: { ...state.config, ...editable(saved) }, message: '', error: '' })
    },
    setProviderText(providerText: string) {
      update({ providerText, providerMessage: '', providerError: '' })
    },
    async save() {
      if (!state.config || state.saving) return
      const submitted = state.config
      update({ saving: true, error: '', message: '' })
      try {
        saved = await desktop.call<ChatConfig>('chat.config.save', editable(submitted))
        const config = state.config === submitted ? saved : { ...saved, ...editable(state.config!) }
        update({ config, message: 'Chat settings saved.' })
      } catch (error) {
        update({ error: readable(error) })
      } finally {
        update({ saving: false })
      }
    },
    async saveProviders() {
      if (state.providerSaving || state.providerLoading) return
      const text = state.providerText
      update({ providerSaving: true, providerError: '', providerMessage: '' })
      try {
        refreshMetadata(await desktop.call<ChatConfig>('chat.providers.save', { text }))
        update({ providerSavedText: text, providerMessage: 'Providers saved.' })
      } catch (error) {
        update({ providerError: readable(error) })
      } finally {
        update({ providerSaving: false })
      }
    },
  }
  return store
}

export type ChatSettingsStore = ReturnType<typeof createChatSettings>
