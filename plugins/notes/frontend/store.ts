import { readable, type Desktop } from '@sisyphus/sdk'
import type { Document, Listing } from './types'

interface Snapshot extends Listing {
  document: Document | null
  content: string
  status: string
  error: string
  busy: boolean
  saveError: boolean
}
export class NotesStore {
  private snapshot: Snapshot = {
    folder: '',
    folders: [],
    projects: [],
    notes: [],
    warnings: [],
    document: null,
    content: '',
    status: '',
    error: '',
    busy: false,
    saveError: false,
  }
  private listeners = new Set<() => void>()
  private timer?: ReturnType<typeof setTimeout>
  private saving?: Promise<void>
  private refreshId = 0
  private disposed = false
  private restoredFolder = ''
  constructor(readonly desktop: Desktop) {}
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private update(patch: Partial<Snapshot>) {
    if (this.disposed) return
    this.snapshot = { ...this.snapshot, ...patch }
    this.listeners.forEach((listener) => listener())
  }
  report = (error: unknown) => this.update({ error: readable(error) })
  private key(path: string) {
    return `sisyphus.notes.draft:${this.snapshot.folder}:${path}`
  }
  private remember() {
    const { document, content } = this.snapshot
    if (document)
      localStorage.setItem(
        this.key(document.path),
        JSON.stringify({ content, revision: document.revision }),
      )
  }
  edit = (content: string) => {
    const unchanged = content === this.snapshot.document?.content && !this.saving
    this.update({
      content,
      status: unchanged ? 'Saved' : 'Unsaved',
      ...(unchanged && this.snapshot.saveError ? { saveError: false, error: '' } : {}),
    })
    try {
      if (unchanged && this.snapshot.document)
        localStorage.removeItem(this.key(this.snapshot.document.path))
      else this.remember()
    } catch (error) {
      this.report(error)
    }
    clearTimeout(this.timer)
    if (unchanged) return
    this.timer = setTimeout(() => {
      void this.save().catch(this.report)
    }, 650)
  }
  save = async (): Promise<void> => {
    clearTimeout(this.timer)
    if (this.saving) {
      await this.saving
      return this.save()
    }
    const { document, content } = this.snapshot
    if (!document || document.content === content) return
    this.update({ status: 'Saving…' })
    this.saving = this.desktop
      .call<Document>('notes.save', { path: document.path, content, revision: document.revision })
      .then((saved) => {
        if (this.snapshot.document?.path !== document.path) return
        this.update({
          document: saved,
          status: this.snapshot.content === content ? 'Saved' : 'Unsaved',
          error: '',
          saveError: false,
        })
        if (this.snapshot.content === content) localStorage.removeItem(this.key(document.path))
        else this.remember()
      })
      .catch((error) => {
        this.update({ error: readable(error), saveError: true, status: 'Not saved' })
        throw error
      })
      .finally(() => {
        this.saving = undefined
      })
    await this.saving
    // A keystroke during IPC must be saved before navigation is allowed.
    if (this.snapshot.content !== content) await this.save()
  }
  refresh = async () => {
    const id = ++this.refreshId
    try {
      const listing = await this.desktop.call<Listing>('notes.list')
      if (id !== this.refreshId || this.disposed) return
      // Polling unchanged files should not reset searches or rerender the whole tree.
      if (
        JSON.stringify(listing) !==
        JSON.stringify({
          folder: this.snapshot.folder,
          projects: this.snapshot.projects,
          notes: this.snapshot.notes,
          folders: this.snapshot.folders,
          warnings: this.snapshot.warnings,
        })
      )
        this.update(listing)
      if (
        !this.snapshot.document &&
        !this.snapshot.busy &&
        listing.folder &&
        this.restoredFolder !== listing.folder
      ) {
        this.restoredFolder = listing.folder
        const last = localStorage.getItem(`sisyphus.notes.last:${listing.folder}`)
        if (last && listing.notes.some((note) => note.path === last)) {
          const restored = await this.desktop.call<Document>('notes.read', { path: last })
          if (id === this.refreshId && !this.snapshot.document && !this.snapshot.busy)
            this.load(restored)
        }
      }
      const doc = this.snapshot.document
      const entry = listing.notes.find((note) => note.path === doc?.path)
      if (doc && !entry && !this.snapshot.busy && !this.saving) {
        if (this.snapshot.content !== doc.content)
          this.update({
            error: 'File removed from disk. Save a copy to keep this draft.',
            saveError: true,
            status: 'Not saved',
          })
        else {
          localStorage.removeItem(`sisyphus.notes.last:${listing.folder}`)
          this.update({ document: null, content: '', status: '', error: '', saveError: false })
        }
      }
      if (
        doc &&
        entry &&
        entry.revision !== doc.revision &&
        this.snapshot.content === doc.content &&
        !this.saving &&
        !this.snapshot.busy
      ) {
        const disk = await this.desktop.call<Document>('notes.read', { path: doc.path })
        if (
          id === this.refreshId &&
          this.snapshot.document === doc &&
          this.snapshot.content === doc.content
        )
          this.update({ document: disk, content: disk.content, status: 'Updated from disk' })
      }
    } catch (error) {
      if (id === this.refreshId) this.update({ error: readable(error) })
    }
  }
  private load(document: Document) {
    let content = document.content,
      error = ''
    try {
      const raw = localStorage.getItem(this.key(document.path))
      if (raw) {
        const draft = JSON.parse(raw)
        if (typeof draft.content === 'string' && typeof draft.revision === 'string') {
          content = draft.content
          if (content !== document.content) {
            error = 'Unsaved draft restored.'
            // Retain the original revision so recovery cannot overwrite newer disk content.
            document = { ...document, revision: draft.revision }
          }
        }
      }
    } catch (cause) {
      error = readable(cause)
    }
    this.update({
      document,
      content,
      error,
      status: content === document.content ? 'Saved' : 'Recovered draft',
      saveError: false,
    })
    localStorage.setItem(`sisyphus.notes.last:${this.snapshot.folder}`, document.path)
  }
  private async perform(work: () => Promise<void>, saveFirst = true) {
    if (this.snapshot.busy) return
    this.refreshId++
    this.update({ busy: true, error: '' })
    try {
      if (saveFirst) await this.save()
      await work()
    } catch (error) {
      this.report(error)
      throw error
    } finally {
      this.update({ busy: false })
    }
    await this.refresh()
  }
  open = (path: string) =>
    this.perform(async () => this.load(await this.desktop.call<Document>('notes.read', { path })))
  create = (path: string) =>
    this.perform(async () =>
      this.load(
        await this.desktop.call<Document>('notes.create', {
          path,
          content: '',
        }),
      ),
    )
  daily = () =>
    this.perform(async () => this.load(await this.desktop.call<Document>('notes.daily')))
  rename = (newPath: string) =>
    this.perform(async () => {
      const doc = this.snapshot.document
      if (doc)
        this.load(
          await this.desktop.call<Document>('notes.rename', {
            path: doc.path,
            newPath,
            revision: doc.revision,
          }),
        )
    })
  trash = () =>
    this.perform(async () => {
      const doc = this.snapshot.document
      if (!doc) return
      await this.desktop.call('notes.trash', { path: doc.path, revision: doc.revision })
      localStorage.removeItem(this.key(doc.path))
      localStorage.removeItem(`sisyphus.notes.last:${this.snapshot.folder}`)
      this.update({ document: null, content: '', status: '', saveError: false })
    })
  chooseFolder = () =>
    this.perform(async () => {
      const listing = await this.desktop.call<Listing | null>('notes.chooseFolder')
      if (listing)
        this.update({ ...listing, document: null, content: '', status: '', saveError: false })
    })
  setFolder = (folder: string) =>
    this.perform(async () => {
      const listing = await this.desktop.call<Listing>('notes.setFolder', { folder })
      this.update({ ...listing, document: null, content: '', status: '', saveError: false })
    })
  createProject = (parent: string, name: string) =>
    this.perform(async () => {
      const listing = await this.desktop.call<Listing>('notes.createProject', { parent, name })
      this.update({ ...listing, document: null, content: '', status: '', saveError: false })
    })
  createFolder = (path: string) =>
    this.perform(async () => {
      await this.desktop.call('notes.createFolder', { path })
    })
  saveCopy = (path: string) =>
    this.perform(async () => {
      if (this.saving) {
        try {
          await this.saving
        } catch {
          /* The draft is copied below. */
        }
      }
      clearTimeout(this.timer)
      const { document, content } = this.snapshot
      const saved = await this.desktop.call<Document>('notes.create', { path, content })
      if (document) localStorage.removeItem(this.key(document.path))
      this.load(saved)
    }, false)
  reload = async () => {
    clearTimeout(this.timer)
    if (this.saving) {
      try {
        await this.saving
      } catch {
        /* Explicit discard follows. */
      }
    }
    const doc = this.snapshot.document
    if (!doc) return
    const disk = await this.desktop.call<Document>('notes.read', { path: doc.path })
    localStorage.removeItem(this.key(doc.path))
    this.update({
      document: disk,
      content: disk.content,
      error: '',
      status: 'Saved',
      saveError: false,
    })
  }
  dispose = () => {
    clearTimeout(this.timer)
    this.disposed = true
    this.listeners.clear()
  }
}
