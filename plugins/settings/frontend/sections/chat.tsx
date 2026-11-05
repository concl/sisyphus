import { useSyncExternalStore, type ReactNode } from 'react'
import type { ChatConfig } from '@sisyphus/sdk'
import type { ChatSettingsStore } from '../chat-store'

export interface ChatSectionProps {
  store: ChatSettingsStore
}

export function ChatSection({
  store,
  children,
}: ChatSectionProps & { children: (config: ChatConfig) => ReactNode }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  if (state.loading) return <p role="status">Loading chat settings…</p>
  if (!state.config)
    return (
      <div>
        <p role="alert">{state.error || 'Chat settings are unavailable.'}</p>
        <button onClick={() => void store.loadConfig()}>Retry</button>
      </div>
    )
  return (
    <fieldset className="settings-fields" disabled={state.saving}>
      {children(state.config)}
    </fieldset>
  )
}

export function AssistantSettings({ store }: ChatSectionProps) {
  return (
    <ChatSection store={store}>
      {(config) => (
        <>
          <label>
            System prompt
            <textarea
              aria-label="System prompt"
              rows={12}
              maxLength={20000}
              required
              value={config.systemPrompt}
              onChange={(event) => store.edit({ systemPrompt: event.target.value })}
            />
          </label>
          <p className="settings-hint">Instructions included with each conversation.</p>
          <button onClick={() => store.edit({ systemPrompt: config.defaultSystemPrompt })}>
            Restore default prompt
          </button>
        </>
      )}
    </ChatSection>
  )
}

export function ContextSettings({ store }: ChatSectionProps) {
  return (
    <ChatSection store={store}>
      {(config) => {
        const compaction = config.compaction ?? { enabled: true, contextTokens: 32000 }
        return (
          <>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={compaction.enabled}
                onChange={(event) =>
                  store.edit({ compaction: { ...compaction, enabled: event.target.checked } })
                }
              />
              Automatically compact earlier context
            </label>
            <label>
              Context budget (tokens)
              <input
                aria-label="Context budget (tokens)"
                type="number"
                min={8000}
                max={2000000}
                step={1000}
                value={compaction.contextTokens}
                onChange={(event) =>
                  store.edit({
                    compaction: {
                      ...compaction,
                      contextTokens: Math.max(
                        8000,
                        Math.min(2000000, Number(event.target.value) || 32000),
                      ),
                    },
                  })
                }
              />
            </label>
            <p className="settings-hint">
              Compaction starts at approximately 75% of this budget. Set it at or below your model’s
              context window; the app does not detect that limit automatically.
            </p>
            <p className="settings-hint">
              Earlier content is shortened and summarized using the selected model. This adds a
              model request and may lose details. The system prompt, latest user message, and recent
              tool exchanges are retained. Full history stays on disk.
            </p>
          </>
        )
      }}
    </ChatSection>
  )
}
