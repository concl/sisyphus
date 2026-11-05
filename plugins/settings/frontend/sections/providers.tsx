import { useSyncExternalStore } from 'react'
import type { ChatSectionProps } from './chat'

export function ProviderSettings({ store }: ChatSectionProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const busy = state.providerLoading || state.providerSaving
  if (state.providerLoading) return <p role="status">Loading providers…</p>
  return (
    <>
      <p>Add providers and model names in JSON. Select a model in Chat.</p>
      {state.config?.providerConfigPath && (
        <p className="settings-provider-path">{state.config.providerConfigPath}</p>
      )}
      {state.config?.providerError && <p role="alert">{state.config.providerError}</p>}
      <label>
        Provider JSON
        <textarea
          aria-label="Provider JSON"
          className="settings-provider-json"
          rows={16}
          spellCheck={false}
          autoComplete="off"
          value={state.providerText}
          disabled={busy}
          onChange={(event) => store.setProviderText(event.target.value)}
        />
      </label>
      <details className="settings-details">
        <summary>Provider format and API keys</summary>
        <p>
          Each provider needs an id, baseURL, and models array. OpenAI-compatible servers use Chat
          Completions. The apiKey field is optional for servers that do not require a key.
        </p>
        <pre>
          {
            '{\n  "providers": [{\n    "id": "local",\n    "baseURL": "http://localhost:1234/v1",\n    "models": ["model-name"]\n  }]\n}'
          }
        </pre>
        <p>
          Keys entered here are stored in this JSON file. An existing migrated key remains encrypted
          unless replaced. Set apiKey to an empty string to stop using it.
        </p>
      </details>
      <div className="settings-actions">
        <button
          className="primary"
          disabled={busy || state.providerText === state.providerSavedText}
          onClick={() => void store.saveProviders()}
        >
          {state.providerSaving ? 'Saving…' : 'Save providers'}
        </button>
        <button
          disabled={busy || state.providerText !== state.providerSavedText}
          title={
            state.providerText !== state.providerSavedText
              ? 'Save or discard changes before reloading.'
              : undefined
          }
          onClick={() => void store.loadProviders(true)}
        >
          Reload from file
        </button>
        {state.providerText !== state.providerSavedText && (
          <button disabled={busy} onClick={() => store.setProviderText(state.providerSavedText)}>
            Discard changes
          </button>
        )}
      </div>
      <p className="settings-hint">After editing the file externally, select Reload from file.</p>
      {state.providerError && <p role="alert">{state.providerError}</p>}
      {state.providerMessage && <p role="status">{state.providerMessage}</p>}
    </>
  )
}
