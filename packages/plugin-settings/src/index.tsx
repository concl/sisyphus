import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  services,
  type AppPlugin,
  type ChatConfig,
  type Desktop,
  type Panels,
  type Theme,
  type ThemePreference,
} from '@sisyphus/sdk'
import icon from './icon.svg'
import './settings.css'

interface Location {
  id: string
  title: string
  description: string
  path: string
  exists: boolean
  directory?: boolean
}
interface Tool {
  name: string
  description: string
  access: string
}

export const settingsPlugin: AppPlugin = {
  id: 'feature.settings',
  name: 'Settings',
  inject: [services.panels, services.desktop, services.theme],
  apply(ctx) {
    const panels = ctx.get(services.panels) as Panels
    const desktop = ctx.get(services.desktop) as Desktop
    const theme = ctx.get(services.theme) as Theme
    function Settings() {
      const appearance = useSyncExternalStore(theme.subscribe, theme.getSnapshot)
      const [section, setSection] = useState('appearance')
      const [config, setConfig] = useState<ChatConfig | null>(null)
      const [key, setKey] = useState('')
      const [clearKey, setClearKey] = useState(false)
      const [locations, setLocations] = useState<Location[]>([])
      const [tools, setTools] = useState<Tool[]>([])
      const [message, setMessage] = useState('')
      const [saving, setSaving] = useState(false)
      useEffect(() => {
        let alive = true
        void Promise.all([
          desktop.call<ChatConfig>('chat.config.get'),
          desktop.call<Location[]>('data.locations'),
          desktop.call<Tool[]>('chat.tools'),
        ])
          .then(([settings, files, available]) => {
            if (alive) {
              setConfig(settings)
              setLocations(files)
              setTools(available)
            }
          })
          .catch((error) => {
            if (alive) setMessage(String(error))
          })
        return () => {
          alive = false
        }
      }, [])
      async function save() {
        if (!config) return
        setSaving(true)
        setMessage('')
        try {
          const saved = await desktop.call<ChatConfig>('chat.config.save', {
            baseURL: config.baseURL,
            model: config.model,
            systemPrompt: config.systemPrompt,
            access: config.access,
            ...(key ? { apiKey: key } : {}),
            clearApiKey: clearKey,
          })
          setConfig(saved)
          setKey('')
          setClearKey(false)
          setMessage('Chat settings saved.')
        } catch (error) {
          setMessage(String(error))
        } finally {
          setSaving(false)
        }
      }
      async function reveal(id: string) {
        try {
          await desktop.call('data.open', { id })
        } catch (error) {
          setMessage(String(error))
        }
      }
      return (
        <div className="settings-panel">
          <header className="settings-heading">
            <div>
              <span className="eyebrow">MAKE IT YOURS</span>
              <h1>Settings</h1>
            </div>
            <img src={icon} alt="" />
          </header>
          <nav className="settings-sections" aria-label="Settings sections">
            {['appearance', 'chat', 'data'].map((id) => (
              <button
                key={id}
                aria-pressed={section === id}
                onClick={() => {
                  setSection(id)
                  setMessage('')
                }}
              >
                {id === 'data' ? 'Local data' : id === 'chat' ? 'Chat' : 'Appearance'}
              </button>
            ))}
          </nav>
          {section === 'appearance' && (
            <section className="settings-card">
              <h2>Appearance</h2>
              <p>Choose a theme, or let your workspace follow the operating system.</p>
              <div className="theme-options">
                {(['system', 'light', 'dark'] as ThemePreference[]).map((value) => (
                  <button
                    key={value}
                    aria-pressed={appearance.theme === value}
                    onClick={() =>
                      void theme.set(value).catch((error) => setMessage(String(error)))
                    }
                  >
                    <span className={`theme-preview ${value}`} />
                    <strong>{value[0].toUpperCase() + value.slice(1)}</strong>
                  </button>
                ))}
              </div>
              <p className="settings-hint">
                Currently using the {appearance.dark ? 'dark' : 'light'} palette. Changes apply
                immediately.
              </p>
            </section>
          )}
          {section === 'chat' && config && (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void save()
              }}
            >
              <section className="settings-card">
                <h2>Model connection</h2>
                <p>
                  Connect to OpenAI or an OpenAI-compatible server. Custom servers use the Chat
                  Completions API.
                </p>
                <label>
                  API base URL
                  <input
                    aria-label="API base URL"
                    type="url"
                    value={config.baseURL}
                    onChange={(event) => setConfig({ ...config, baseURL: event.target.value })}
                    required
                  />
                </label>
                <p className="settings-hint">
                  Include the API prefix, for example https://api.openai.com/v1 or
                  http://localhost:1234/v1.
                </p>
                <label>
                  Model ID
                  <input
                    aria-label="Model ID"
                    placeholder="Enter a model provided by your server"
                    value={config.model}
                    onChange={(event) => setConfig({ ...config, model: event.target.value })}
                  />
                </label>
                <label>
                  API key
                  <input
                    aria-label="API key"
                    type="password"
                    autoComplete="off"
                    value={key}
                    placeholder={
                      config.hasApiKey
                        ? 'A key is saved. Leave blank to keep it.'
                        : 'Optional for local servers'
                    }
                    onChange={(event) => setKey(event.target.value)}
                  />
                </label>
                <p className="settings-hint">
                  Stored with OS encryption. Changing the URL clears the old key unless you enter a
                  replacement.
                </p>
                {config.hasApiKey && (
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      checked={clearKey}
                      onChange={(event) => setClearKey(event.target.checked)}
                    />
                    Remove the saved API key
                  </label>
                )}
              </section>
              <section className="settings-card">
                <h2>Assistant behavior</h2>
                <label>
                  System prompt
                  <textarea
                    aria-label="System prompt"
                    rows={8}
                    value={config.systemPrompt}
                    onChange={(event) => setConfig({ ...config, systemPrompt: event.target.value })}
                    required
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setConfig({ ...config, systemPrompt: config.defaultSystemPrompt })}
                >
                  Restore default prompt
                </button>
              </section>
              <section className="settings-card">
                <h2>Tools and access</h2>
                <p>
                  Tool results are sent to your configured model provider as part of the
                  conversation. Credentials and anything outside the conversation folder are never
                  exposed as tools.
                </p>
                <label>
                  Access level
                  <select
                    aria-label="Tool access"
                    value={config.access}
                    onChange={(event) =>
                      setConfig({ ...config, access: event.target.value as ChatConfig['access'] })
                    }
                  >
                    <option value="none">No tools</option>
                    <option value="read">Read files and app data</option>
                    <option value="write">Read and change files and app data</option>
                  </select>
                </label>
                <p className="settings-hint">
                  Read covers planner records and file reads. Read and change also allows file edits
                  and shell commands. Files and commands stay inside the folder chosen for each
                  conversation in the Chat block.
                </p>
                <ul className="settings-tools">
                  {tools.map((tool) => (
                    <li key={tool.name}>
                      <strong>{tool.name}</strong>
                      <span>
                        {tool.access} · {tool.description}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
              <div className="settings-save">
                <button className="primary" type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Save chat settings'}
                </button>
                <button type="button" onClick={() => panels.open('chat')}>
                  Open Chat
                </button>
              </div>
            </form>
          )}
          {section === 'data' && (
            <section className="settings-card">
              <div className="settings-data-heading">
                <div>
                  <h2>Local data</h2>
                  <p>Every file has a purpose. Open a location to inspect or back it up.</p>
                </div>
                <button className="primary" onClick={() => void reveal('all')}>
                  Open app data folder
                </button>
              </div>
              <div className="data-locations">
                {locations
                  .filter((location) => location.id !== 'all')
                  .map((location) => (
                    <article key={location.id}>
                      <div>
                        <strong>{location.title}</strong>
                        <p>{location.description}</p>
                        <code>{location.path}</code>
                        {!location.exists && <small>Created when first used</small>}
                      </div>
                      <button onClick={() => void reveal(location.id)}>
                        {location.exists && !location.directory ? 'Reveal file' : 'Open folder'}
                      </button>
                    </article>
                  ))}
              </div>
            </section>
          )}
          {message && (
            <p className="settings-message" role="status">
              {message}
            </p>
          )}
        </div>
      )
    }
    ctx.effect(() =>
      panels.register({
        id: 'settings',
        title: 'Settings',
        description: 'Appearance, chat, and local data.',
        icon,
        component: Settings,
      }),
    )
  },
}
