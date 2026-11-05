import { useSyncExternalStore } from 'react'
import type { ChatConfig } from '@sisyphus/sdk'
import { ChatSection, type ChatSectionProps } from './chat'

export function ToolSettings({ store }: ChatSectionProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return (
    <ChatSection store={store}>
      {(config) => (
        <>
          <label>
            Access level
            <select
              aria-label="Tool access"
              value={config.access}
              onChange={(event) =>
                store.edit({ access: event.target.value as ChatConfig['access'] })
              }
            >
              <option value="none">No tools</option>
              <option value="read">Read files and app data</option>
              <option value="write">Read, change, and control the computer</option>
            </select>
          </label>
          <p className="settings-hint">
            File tools are scoped to the conversation folder. Write access also permits file edits,
            shell commands, and desktop control when the Computer plugin is enabled.
          </p>
          <p className="settings-hint">
            Tool results, including screenshots, are sent to the selected model provider. Computer
            tools can see and control the desktop and require a model that supports images.
          </p>
          <details className="settings-details">
            <summary>
              Available tools
              {!state.toolsLoading && !state.toolsError ? ` (${state.tools.length})` : ''}
            </summary>
            {state.toolsLoading && <p role="status">Loading tools…</p>}
            {state.toolsError && (
              <div>
                <p role="alert">{state.toolsError}</p>
                <button onClick={() => void store.loadTools()}>Retry</button>
              </div>
            )}
            {!state.toolsLoading && !state.toolsError && !state.tools.length && (
              <p>No tools available.</p>
            )}
            <ul className="settings-tools">
              {state.tools.map((tool) => (
                <li key={tool.name}>
                  <strong>{tool.name}</strong>
                  <span>
                    {tool.access} · {tool.description}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </ChatSection>
  )
}
