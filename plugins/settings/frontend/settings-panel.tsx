import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Settings, SettingsSection } from '@sisyphus/sdk'
import type { ChatSettingsStore } from './chat-store'
import { searchSections } from './registry'
import { SectionBoundary } from './section-boundary'

export function SettingsPanel({ settings, chat }: { settings: Settings; chat: ChatSettingsStore }) {
  const sections = useSyncExternalStore(settings.subscribe, settings.getSnapshot)
  const state = useSyncExternalStore(chat.subscribe, chat.getSnapshot)
  const [selected, setSelected] = useState('appearance.theme')
  const [query, setQuery] = useState('')
  useEffect(() => {
    void chat.load()
  }, [chat])
  const results = searchSections(sections, query)
  const searching = Boolean(query.trim())
  const current = sections.find((section) => section.id === selected) ?? sections[0]
  const groups = new Map<string, SettingsSection[]>()
  for (const section of sections)
    groups.set(section.category, [...(groups.get(section.category) ?? []), section])
  const providerDirty = state.providerText !== state.providerSavedText
  function select(id: string) {
    setSelected(id)
    setQuery('')
  }
  const Section = current?.component
  return (
    <div className="settings-panel">
      <header className="settings-heading">
        <h1>Settings</h1>
        <div className="settings-search">
          <input
            type="search"
            aria-label="Search settings"
            placeholder="Search settings"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear settings search">
              Clear
            </button>
          )}
        </div>
      </header>
      <div className="settings-layout">
        <nav className="settings-sections" aria-label="Settings sections">
          {[...groups].map(([category, items]) => (
            <div className="settings-category" key={category}>
              <h2>{category}</h2>
              {items.map((section) => (
                <button
                  key={section.id}
                  aria-current={!searching && current?.id === section.id ? 'page' : undefined}
                  onClick={() => select(section.id)}
                >
                  {section.title}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="settings-content">
          {searching ? (
            <section className="settings-results" aria-label="Search results">
              <h2>Search results</h2>
              <p role="status">
                {results.length
                  ? `${results.length} ${results.length === 1 ? 'section' : 'sections'} found`
                  : 'No settings found.'}
              </p>
              {results.map((section) => (
                <button
                  key={section.id}
                  className="settings-result"
                  onClick={() => select(section.id)}
                >
                  <span className="settings-result-category">{section.category}</span>
                  <strong>{section.title}</strong>
                  <span>{section.description}</span>
                </button>
              ))}
            </section>
          ) : current && Section ? (
            <section
              className="settings-card"
              aria-labelledby="settings-section-title"
              key={current.id}
            >
              <header>
                <h2 id="settings-section-title">{current.title}</h2>
                <p>{current.description}</p>
              </header>
              <SectionBoundary key={current.id}>
                <Section />
              </SectionBoundary>
            </section>
          ) : (
            <p>No settings available.</p>
          )}
          {(state.dirty ||
            state.message ||
            (state.error && current?.category === 'Chat' && state.config) ||
            providerDirty) && (
            <footer className="settings-footer">
              {state.dirty && (
                <div className="settings-actions">
                  <span role="status">Unsaved chat settings</span>
                  <button
                    className="primary"
                    disabled={state.saving}
                    onClick={() => void chat.save()}
                  >
                    {state.saving ? 'Saving…' : 'Save chat settings'}
                  </button>
                  <button disabled={state.saving} onClick={chat.discard}>
                    Discard changes
                  </button>
                </div>
              )}
              {providerDirty && (
                <div className="settings-actions">
                  <span>Unsaved provider changes</span>
                  <button onClick={() => select('chat.providers')}>Review providers</button>
                </div>
              )}
              {state.error && state.config && <p role="alert">{state.error}</p>}
              {state.message && <p role="status">{state.message}</p>}
            </footer>
          )}
        </div>
      </div>
    </div>
  )
}
