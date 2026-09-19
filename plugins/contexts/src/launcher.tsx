import { useEffect, useRef, useState } from 'react'
import {
  type AppContext,
  type AppContextAction,
  type Desktop,
  type IntegrationStatus,
} from '@sisyphus/sdk'
import editorIcon from './editor.svg'
import browserIcon from './browser.svg'
import './contexts.css'

type Integration = AppContextAction['integration']
interface Draft {
  id?: string
  name: string
  folders: string[]
  profile: string
  window: 'new' | 'reuse'
  urls: string
}
const blank = (): Draft => ({ name: '', folders: [], profile: '', window: 'new', urls: '' })
const folderName = (value: string) => value.split(/[\\/]/).filter(Boolean).pop() || value

function draftFor(context: AppContext, action: AppContextAction): Draft {
  return action.integration === 'vscode'
    ? {
        ...blank(),
        id: context.id,
        name: context.name,
        folders: action.folders,
        profile: action.profile ?? '',
        window: action.window,
      }
    : { ...blank(), id: context.id, name: context.name, urls: action.urls.join('\n') }
}

export function Launcher({ desktop, integration }: { desktop: Desktop; integration: Integration }) {
  const isEditor = integration === 'vscode'
  const [contexts, setContexts] = useState<AppContext[]>([])
  const [available, setAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const nameInput = useRef<HTMLInputElement>(null)
  const newButton = useRef<HTMLButtonElement>(null)
  const editing = draft !== null

  useEffect(() => {
    let alive = true
    const off = desktop.on<AppContext[]>('contexts.changed', (saved) => {
      if (alive) setContexts(saved)
    })
    void Promise.all([
      desktop.call<AppContext[]>('contexts.list'),
      desktop.call<IntegrationStatus[]>('contexts.integrations'),
    ])
      .then(([saved, statuses]) => {
        if (!alive) return
        setContexts(saved)
        setAvailable(statuses.some((item) => item.id === integration && item.available))
      })
      .catch((problem) => {
        if (alive) setError(String(problem))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
      off()
    }
  }, [desktop, integration])

  useEffect(() => {
    if (editing) nameInput.current?.focus()
  }, [editing])

  function edit(value: Draft) {
    setDraft(value)
    setConfirmDelete(false)
    setError('')
    setMessage('')
  }

  function closeEditor() {
    setDraft(null)
    setConfirmDelete(false)
    requestAnimationFrame(() => newButton.current?.focus())
  }

  async function addFolder() {
    setBusy(true)
    try {
      const { folder } = await desktop.call<{ folder?: string }>('contexts.folder.choose')
      if (folder)
        setDraft((current) =>
          current && !current.folders.includes(folder)
            ? {
                ...current,
                name: current.name || folderName(folder),
                folders: [...current.folders, folder],
              }
            : current,
        )
    } catch (problem) {
      setError(String(problem))
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!draft || busy) return
    setBusy(true)
    setError('')
    try {
      const action: AppContextAction = isEditor
        ? {
            integration: 'vscode',
            folders: draft.folders,
            profile: draft.profile,
            window: draft.window,
          }
        : {
            integration: 'browser',
            urls: draft.urls
              .split(/\r?\n/)
              .map((url) => url.trim())
              .filter(Boolean),
          }
      await desktop.call('contexts.saveAction', { id: draft.id, name: draft.name, action })
      setContexts(await desktop.call<AppContext[]>('contexts.list'))
      setQuery('')
      closeEditor()
      setMessage(`Saved ${draft.name.trim()}.`)
    } catch (problem) {
      setError(String(problem))
    } finally {
      setBusy(false)
    }
  }

  async function launch(context: AppContext) {
    if (opening) return
    setOpening(context.id)
    setError('')
    setMessage('')
    try {
      await desktop.call('contexts.launch', { id: context.id, integration })
      setMessage(`Opened ${context.name}.`)
    } catch (problem) {
      setError(String(problem))
    } finally {
      setOpening(null)
    }
  }

  async function remove() {
    if (!draft?.id || busy) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setBusy(true)
    try {
      await desktop.call('contexts.delete', { id: draft.id, integration })
      setContexts(await desktop.call<AppContext[]>('contexts.list'))
      closeEditor()
      setMessage('Removed from saved entries.')
    } catch (problem) {
      setError(String(problem))
    } finally {
      setBusy(false)
    }
  }

  const entries = contexts.flatMap((context) =>
    context.actions
      .filter((action) => action.integration === integration)
      .map((action) => ({ context, action })),
  )
  const visible = entries.filter(({ context, action }) =>
    [context.name, ...(action.integration === 'vscode' ? action.folders : action.urls)]
      .join(' ')
      .toLowerCase()
      .includes(query.toLowerCase()),
  )

  return (
    <div className="contexts-panel">
      <header className="launcher-heading">
        <div>
          <h1>{isEditor ? 'VS Code' : 'Browser tabs'}</h1>
          <p>
            {isEditor ? 'Your projects, ready to open.' : 'The pages you come back to, together.'}
          </p>
        </div>
        <button
          ref={newButton}
          className="launcher-new"
          disabled={editing || loading}
          onClick={() => edit(blank())}
        >
          <span aria-hidden="true">+</span> {isEditor ? 'New workspace' : 'New tab set'}
        </button>
      </header>

      {draft ? (
        <form
          className="launcher-editor"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !busy) closeEditor()
          }}
        >
          <fieldset disabled={busy}>
            <div className="launcher-editor-heading">
              <h2>
                {draft.id ? 'Edit' : 'New'} {isEditor ? 'workspace' : 'tab set'}
              </h2>
              <button type="button" className="launcher-text-button" onClick={closeEditor}>
                Cancel
              </button>
            </div>
            <label>
              Name
              <input
                ref={nameInput}
                required
                maxLength={60}
                value={draft.name}
                placeholder={isEditor ? 'e.g. Sisyphus' : 'e.g. Morning reading'}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            {isEditor ? (
              <>
                <div className="launcher-folder-heading">
                  <span>Folders</span>
                  <button
                    type="button"
                    className="launcher-text-button"
                    onClick={() => void addFolder()}
                  >
                    + Add folder
                  </button>
                </div>
                <div className="launcher-folders">
                  {draft.folders.map((folder) => (
                    <div key={folder}>
                      <span title={folder}>{folder}</span>
                      <button
                        type="button"
                        className="launcher-text-button"
                        aria-label={`Remove ${folder}`}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            folders: draft.folders.filter((item) => item !== folder),
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  {!draft.folders.length && (
                    <button
                      type="button"
                      className="launcher-folder-empty"
                      onClick={() => void addFolder()}
                    >
                      Choose a project folder <span aria-hidden="true">↗</span>
                    </button>
                  )}
                </div>
                <details className="launcher-options">
                  <summary>Window &amp; profile</summary>
                  <div>
                    <label>
                      Window
                      <select
                        value={draft.window}
                        onChange={(event) =>
                          setDraft({ ...draft, window: event.target.value as Draft['window'] })
                        }
                      >
                        <option value="new">New window</option>
                        <option value="reuse">Reuse active window</option>
                      </select>
                    </label>
                    <label>
                      VS Code profile
                      <input
                        maxLength={80}
                        value={draft.profile}
                        placeholder="Default profile"
                        onChange={(event) => setDraft({ ...draft, profile: event.target.value })}
                      />
                    </label>
                  </div>
                </details>
              </>
            ) : (
              <label>
                Pages{' '}
                <span className="launcher-hint">
                  One address per line · opens in your default browser
                </span>
                <textarea
                  required
                  rows={6}
                  value={draft.urls}
                  placeholder={'https://github.com\nhttps://developer.mozilla.org'}
                  onChange={(event) => setDraft({ ...draft, urls: event.target.value })}
                />
              </label>
            )}
            <div className="launcher-editor-actions">
              <button
                className="primary"
                type="submit"
                disabled={isEditor && !draft.folders.length}
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
              {draft.id && (
                <button
                  type="button"
                  className="launcher-text-button launcher-delete"
                  onClick={() => void remove()}
                >
                  {confirmDelete ? 'Confirm remove' : 'Remove saved entry'}
                </button>
              )}
            </div>
          </fieldset>
        </form>
      ) : (
        <>
          <div className="launcher-list-heading">
            <span>
              {isEditor ? 'WORKSPACES' : 'TAB SETS'}{' '}
              <b>{String(entries.length).padStart(2, '0')}</b>
            </span>
            {entries.length > 0 && (
              <input
                type="search"
                aria-label="Filter saved entries"
                placeholder="Filter…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            )}
          </div>
          {loading ? (
            <p className="launcher-empty">Loading…</p>
          ) : visible.length ? (
            <ul className="launcher-list">
              {visible.map(({ context, action }) => (
                <li key={context.id}>
                  <button
                    className="launcher-entry"
                    disabled={Boolean(opening) || !available}
                    onClick={() => void launch(context)}
                    aria-label={`Open ${context.name}`}
                  >
                    <span
                      className="icon-mask"
                      style={{ maskImage: `url("${isEditor ? editorIcon : browserIcon}")` }}
                      aria-hidden="true"
                    />
                    <span className="launcher-entry-copy">
                      <strong>{context.name}</strong>
                      <span>
                        {action.integration === 'vscode'
                          ? action.folders.map(folderName).join(' / ')
                          : action.urls.map((url) => new URL(url).hostname).join(' · ')}
                      </span>
                    </span>
                    <span className="launcher-entry-count">
                      {action.integration === 'vscode'
                        ? `${action.folders.length} ${action.folders.length === 1 ? 'folder' : 'folders'}`
                        : `${action.urls.length} ${action.urls.length === 1 ? 'tab' : 'tabs'}`}
                    </span>
                    <span className="launcher-entry-arrow" aria-hidden="true">
                      {opening === context.id ? '…' : '↗'}
                    </span>
                  </button>
                  <button
                    className="launcher-edit launcher-text-button"
                    disabled={Boolean(opening)}
                    aria-label={`Edit ${context.name}`}
                    onClick={() => edit(draftFor(context, action))}
                  >
                    Edit
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="launcher-empty">
              <h2>
                {query
                  ? 'No matches'
                  : isEditor
                    ? 'Keep your projects close.'
                    : 'A place for your regular stops.'}
              </h2>
              <p>
                {query
                  ? 'Try another name or address.'
                  : isEditor
                    ? 'Save a repo or a few related folders. Open them in VS Code with one click.'
                    : 'Save a few pages as a tab set. Open them together whenever you need them.'}
              </p>
              {!query && (
                <button className="launcher-text-button" onClick={() => edit(blank())}>
                  {isEditor ? 'Add your first workspace' : 'Add your first tab set'}{' '}
                  <span aria-hidden="true">↗</span>
                </button>
              )}
            </div>
          )}
        </>
      )}
      {!available && (
        <p className="launcher-feedback">
          {isEditor
            ? 'VS Code is unavailable. Check that it is installed.'
            : 'The browser integration is unavailable.'}
        </p>
      )}
      {error && (
        <p className="launcher-feedback error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="launcher-feedback" role="status">
          {message}
        </p>
      )}
    </div>
  )
}
