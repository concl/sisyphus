import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Streamdown } from 'streamdown'
import { readable } from '@sisyphus/sdk'
import {
  ChevronLeftIcon,
  FileIcon,
  FolderIcon,
  PanelLeftIcon,
  PlusIcon,
  ResizableSidebar,
  useSidebarSize,
} from '@sisyphus/ui'
import type { NotesStore } from './store'
import { previewMarkdown, resolveLink, type Listing } from './types'
import { FileTree } from './file-tree'

type DialogKind = 'create' | 'folder' | 'project' | 'rename' | 'copy' | 'trash' | 'reload'
const folderName = (folder: string) => folder.split(/[\\/]/).filter(Boolean).at(-1) || folder

function Modal({ children, onCancel }: { children: ReactNode; onCancel(): void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return (
    <dialog
      className="notes-dialog"
      ref={ref}
      aria-labelledby="notes-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
    >
      {children}
    </dialog>
  )
}

export function NotesPanel({ store }: { store: NotesStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<{
    query: string
    folder: string
    paths: string[]
    error: string
  }>({ query: '', folder: '', paths: [], error: '' })
  const [mode, setMode] = useState<'edit' | 'split' | 'read'>('edit')
  const [dialog, setDialog] = useState<DialogKind | null>(null)
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')
  const [selectedFolder, setSelectedFolder] = useState({ project: '', path: '' })
  const [dialogError, setDialogError] = useState('')
  const [pending, setPending] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const editor = useRef<HTMLTextAreaElement>(null)
  const [compact, setCompact] = useState(false)
  const sidebar = useSidebarSize({ defaultWidth: 236, maxWidth: 380 })
  const doc = state.document
  const selected =
    selectedFolder.project === state.folder && state.folders.includes(selectedFolder.path)
      ? selectedFolder.path
      : ''
  const busy = pending || state.busy
  const run = (promise: Promise<unknown>) => {
    void promise.catch(store.report)
  }
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const width = entries[0].contentRect.width
      if (width > 0) setCompact(width < 620)
    })
    if (root.current) observer.observe(root.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!query || !state.folder) return
    let alive = true
    const timer = setTimeout(() => {
      void store.desktop
        .call<Listing>('notes.list', { query })
        .then((result) => {
          if (alive)
            setSearch({
              query,
              folder: result.folder,
              paths: result.notes.map((note) => note.path),
              error: '',
            })
        })
        .catch((error) => {
          if (alive) setSearch({ query, folder: state.folder, paths: [], error: readable(error) })
        })
    }, 180)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query, state.folder, state.notes, store])
  useEffect(() => {
    if (doc?.path && mode !== 'read' && !busy && !dialog) editor.current?.focus()
  }, [doc?.path, mode, busy, dialog])
  const openDialog = (kind: DialogKind, value = '') => {
    setName(value)
    setDialogError('')
    setDialog(kind)
  }
  const open = async (path: string) => {
    await store.open(path)
    if (compact) sidebar.setOpen(false)
  }
  const navigate = (link: string) => {
    const target = resolveLink(link, doc?.path || '', state.notes)
    if (target) run(open(target))
    else openDialog('create', link.split('#')[0].replace(/\.md$/i, ''))
  }
  const backlinks = doc
    ? state.notes.filter(
        (note) =>
          note.path !== doc.path &&
          note.links.some((link) => resolveLink(link, note.path, state.notes) === doc.path),
      )
    : []
  const searching = query && (search.query !== query || search.folder !== state.folder)
  const matches = searching ? [] : state.notes.filter((note) => search.paths.includes(note.path))
  async function submit() {
    setPending(true)
    try {
      if (dialog === 'create') await store.create(name)
      if (dialog === 'folder') {
        await store.createFolder(name)
        setSelectedFolder({ project: state.folder, path: name.trim().replaceAll('\\', '/') })
      }
      if (dialog === 'project') {
        await store.createProject(parent, name)
        setQuery('')
      }
      if (dialog === 'rename') await store.rename(name)
      if (dialog === 'copy') await store.saveCopy(name)
      if (dialog === 'trash') await store.trash()
      if (dialog === 'reload') await store.reload()
      if (compact && ['create', 'copy'].includes(dialog || '')) sidebar.setOpen(false)
      setDialog(null)
    } catch (error) {
      setDialogError(readable(error))
    } finally {
      setPending(false)
    }
  }
  const projectButtons = (
    <>
      <button disabled={busy} onClick={() => run(store.chooseFolder().then(() => setQuery('')))}>
        Open folder
      </button>
      <button disabled={busy} onClick={() => openDialog('project')}>
        New project
      </button>
    </>
  )
  return (
    <div
      className="notes-app"
      ref={root}
      data-compact={compact}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          run(store.save())
        }
        if (event.key === 'Escape' && !dialog && compact) sidebar.setOpen(false)
      }}
    >
      <ResizableSidebar
        className="notes-sidebar"
        label="Files"
        width={sidebar.width}
        open={sidebar.open}
        resizing={sidebar.resizing}
        overlay={compact}
        handleProps={sidebar.handleProps}
      >
        <div className="notes-sidebar-body">
          <header className="notes-sidebar-head">
            <h2>Notes</h2>
            <button
              className="notes-icon"
              onClick={() => sidebar.setOpen(false)}
              title="Hide files"
              aria-label="Hide files"
            >
              <ChevronLeftIcon />
            </button>
          </header>
          <div className="notes-project">
            <label htmlFor="notes-project">Project</label>
            <div className="notes-project-select">
              <FolderIcon size={14} />
              <select
                id="notes-project"
                aria-label="Project"
                title={state.folder}
                value={state.folder}
                disabled={busy}
                onChange={(event) =>
                  run(store.setFolder(event.target.value).then(() => setQuery('')))
                }
              >
                {!state.folder && <option value="">No project</option>}
                {state.projects.map((folder) => (
                  <option key={folder} value={folder}>
                    {folderName(folder)}
                  </option>
                ))}
              </select>
            </div>
            <div className="notes-project-actions">{projectButtons}</div>
          </div>
          {state.folder && (
            <>
              <div className="notes-search">
                <input
                  aria-label="Search notes"
                  type="search"
                  placeholder="Search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className="notes-file-tools">
                <button
                  disabled={busy}
                  onClick={() => openDialog('create', selected ? `${selected}/` : '')}
                  aria-label="Create a note"
                >
                  <PlusIcon size={14} />
                  New note
                </button>
                <button
                  className="notes-icon"
                  disabled={busy}
                  onClick={() => openDialog('folder', selected ? `${selected}/` : '')}
                  title="New folder"
                  aria-label="New folder"
                >
                  <FolderIcon size={14} />
                </button>
              </div>
              <nav className="notes-list" aria-label="Notes">
                {query ? (
                  <>
                    {searching ? (
                      <p>Searching…</p>
                    ) : search.error ? (
                      <p role="alert">{search.error}</p>
                    ) : matches.length ? (
                      matches.map((note) => (
                        <button
                          className="notes-search-result"
                          key={note.path}
                          disabled={busy}
                          onClick={() => run(open(note.path))}
                        >
                          <FileIcon size={14} />
                          <span>{note.path}</span>
                        </button>
                      ))
                    ) : (
                      <p>No results</p>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      className="notes-tree-root"
                      aria-pressed={!selected}
                      onClick={() => setSelectedFolder({ project: state.folder, path: '' })}
                      title={state.folder}
                    >
                      <FolderIcon size={14} />
                      <span>{folderName(state.folder)}</span>
                    </button>
                    <FileTree
                      key={state.folder}
                      notes={state.notes}
                      folders={state.folders}
                      active={doc?.path}
                      selectedFolder={selected}
                      disabled={busy}
                      onOpen={(path) => run(open(path))}
                      onFolder={(path) => setSelectedFolder({ project: state.folder, path })}
                    />
                    {!state.notes.length && !state.folders.length && <p>No notes</p>}
                  </>
                )}
              </nav>
              <footer className="notes-sidebar-footer">
                <button disabled={busy} onClick={() => run(store.daily())}>
                  Daily note
                </button>
                <button disabled={busy} onClick={() => run(store.desktop.call('notes.reveal'))}>
                  Show folder
                </button>
              </footer>
            </>
          )}
        </div>
      </ResizableSidebar>
      {compact && sidebar.open && (
        <button
          className="notes-scrim"
          aria-label="Close files"
          onClick={() => sidebar.setOpen(false)}
        />
      )}
      <main className="notes-main">
        <header className="notes-toolbar">
          <button
            className="notes-icon"
            onClick={sidebar.toggle}
            aria-label={sidebar.open ? 'Hide files' : 'Show files'}
            aria-expanded={sidebar.open}
          >
            <PanelLeftIcon />
          </button>
          <span className="notes-title" title={doc?.path}>
            {doc?.path || (state.folder ? folderName(state.folder) : 'Notes')}
          </span>
          {doc && (
            <>
              <div className="notes-modes" aria-label="Editor mode">
                {(['edit', 'split', 'read'] as const).map((value) => (
                  <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>
                    {value === 'edit' ? 'Edit' : value === 'split' ? 'Split' : 'Read'}
                  </button>
                ))}
              </div>
              <details
                className="notes-menu"
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget))
                    event.currentTarget.open = false
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') event.currentTarget.open = false
                }}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('button'))
                    event.currentTarget.open = false
                }}
              >
                <summary aria-label="Note actions" title="Note actions">
                  ⋯
                </summary>
                <div>
                  <button disabled={busy} onClick={() => run(store.save())}>
                    Save
                  </button>
                  <button disabled={busy} onClick={() => openDialog('rename', doc.path)}>
                    Rename / move
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => openDialog('copy', doc.path.replace(/\.md$/i, ' copy.md'))}
                  >
                    Save copy…
                  </button>
                  <button disabled={busy} onClick={() => openDialog('reload')}>
                    Reload from disk…
                  </button>
                  <button disabled={busy} onClick={() => openDialog('trash')}>
                    Move to trash
                  </button>
                </div>
              </details>
            </>
          )}
        </header>
        {state.error && (
          <div className="notes-alert" role="alert">
            <span>{state.error}</span>
            {state.saveError && doc && (
              <>
                <button onClick={() => openDialog('copy', doc.path.replace(/\.md$/i, ' copy.md'))}>
                  Save copy…
                </button>
                <button onClick={() => openDialog('reload')}>Reload…</button>
              </>
            )}
          </div>
        )}
        {!!state.warnings.length && (
          <details className="notes-warnings">
            <summary>{state.warnings.length} unreadable files</summary>
            {state.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </details>
        )}
        {doc ? (
          <>
            <div className={`notes-content notes-${mode}`}>
              {mode !== 'read' && (
                <textarea
                  ref={editor}
                  aria-label="Markdown editor"
                  spellCheck={false}
                  value={state.content}
                  disabled={busy}
                  onChange={(event) => store.edit(event.target.value)}
                />
              )}
              {mode !== 'edit' && (
                <article className="notes-preview" aria-label="Markdown preview">
                  <Streamdown
                    mode="static"
                    controls={false}
                    skipHtml
                    components={{
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          onClick={(event) => {
                            if (!href || (href.startsWith('#') && !href.startsWith('#note=')))
                              return
                            event.preventDefault()
                            try {
                              if (href.startsWith('#note='))
                                navigate(decodeURIComponent(href.slice(6)))
                              else if (/^https?:/i.test(href))
                                run(store.desktop.call('notes.openExternal', { url: href }))
                              else if (!/^[a-z]+:/i.test(href)) navigate(decodeURIComponent(href))
                            } catch (error) {
                              store.report(error)
                            }
                          }}
                        >
                          {children}
                        </a>
                      ),
                      img: ({ alt }) => <span>[Image: {alt || 'attachment'}]</span>,
                    }}
                  >
                    {previewMarkdown(state.content)}
                  </Streamdown>
                </article>
              )}
            </div>
            <details className="notes-links">
              <summary>Backlinks ({backlinks.length})</summary>
              <div>
                {backlinks.map((note) => (
                  <button key={note.path} onClick={() => run(open(note.path))}>
                    {note.path}
                  </button>
                ))}
                {!backlinks.length && <span>None</span>}
              </div>
            </details>
            <footer className="notes-status">
              <span role="status">{state.status}</span>
              <span>
                {state.content.trim() ? state.content.trim().split(/\s+/).length : 0} words
              </span>
            </footer>
          </>
        ) : (
          <div className="notes-empty">
            {state.folder ? (
              <span>No note selected</span>
            ) : (
              <>
                <span>Open a project folder.</span>
                <div>{projectButtons}</div>
              </>
            )}
          </div>
        )}
      </main>
      {dialog && (
        <Modal
          onCancel={() => {
            if (!busy) setDialog(null)
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <h2 id="notes-dialog-title">
              {
                {
                  create: 'New note',
                  folder: 'New folder',
                  project: 'New project',
                  rename: 'Rename / move',
                  copy: 'Save copy',
                  trash: 'Move to trash?',
                  reload: 'Reload from disk?',
                }[dialog]
              }
            </h2>
            {dialog === 'trash' || dialog === 'reload' ? (
              <p>
                {dialog === 'trash'
                  ? 'Move this file to .trash in the project folder.'
                  : 'Discard this draft and load the file from disk.'}
              </p>
            ) : (
              <>
                <label htmlFor="notes-path">{dialog === 'project' ? 'Folder name' : 'Path'}</label>
                <input
                  id="notes-path"
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={dialog === 'project' ? '' : 'Untitled.md'}
                  required
                />
                {dialog === 'project' && (
                  <>
                    <label>Location</label>
                    <div className="notes-location">
                      <span title={parent}>{parent || 'Not selected'}</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setPending(true)
                          void store.desktop
                            .call<string | null>('notes.chooseParent')
                            .then((value) => {
                              if (value) setParent(value)
                            })
                            .catch((error) => setDialogError(readable(error)))
                            .finally(() => setPending(false))
                        }}
                      >
                        Choose folder
                      </button>
                    </div>
                  </>
                )}
                {dialog === 'rename' && <p>Links in other notes keep their current paths.</p>}
              </>
            )}
            {dialogError && (
              <p className="notes-dialog-error" role="alert">
                {dialogError}
              </p>
            )}
            <footer>
              <button type="button" disabled={busy} onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button disabled={busy || (dialog === 'project' && !parent)} type="submit">
                {
                  {
                    create: 'Create note',
                    folder: 'Create folder',
                    project: 'Create project',
                    rename: 'Rename',
                    copy: 'Save copy',
                    trash: 'Move to trash',
                    reload: 'Discard & reload',
                  }[dialog]
                }
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </div>
  )
}
