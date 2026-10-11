import { services, type AppPlugin, type Desktop, type Panels } from '@sisyphus/sdk'
import { NotesStore } from './store'
import { NotesPanel } from './panel'
import icon from './icon.svg'
import './notes.css'

export const notesPlugin: AppPlugin = {
  id: 'feature.notes',
  name: 'Notes',
  inject: [services.desktop, services.panels],
  provide: ['notes.v1'],
  apply(ctx) {
    const desktop = ctx.get(services.desktop) as Desktop
    const notes = new NotesStore(desktop)
    ctx.provide('notes.v1', notes)
    ctx.effect(() =>
      (ctx.get(services.panels) as Panels).register({
        id: 'notes',
        title: 'Notes',
        icon,
        description: 'Markdown notes in a project folder.',
        component: () => <NotesPanel store={notes} />,
      }),
    )
    ctx.effect(() =>
      desktop.on('notes.changed', () => {
        void notes.refresh()
      }),
    )
    ctx.effect(() => {
      // Read external edits too, including changes made in Obsidian or an editor.
      const interval = setInterval(() => {
        void notes.refresh()
      }, 4000)
      void notes.refresh()
      return () => {
        clearInterval(interval)
        notes.dispose()
      }
    })
  },
}
