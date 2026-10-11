import { FileIcon, FolderIcon } from '@sisyphus/ui'
import type { Note } from './types'

interface TreeProps {
  notes: Note[]
  folders: string[]
  active?: string
  selectedFolder: string
  disabled: boolean
  onOpen(path: string): void
  onFolder(path: string): void
}
export function FileTree({
  notes,
  folders,
  active,
  selectedFolder,
  disabled,
  onOpen,
  onFolder,
}: TreeProps) {
  function branch(parent: string) {
    const within = (name: string) =>
      name.includes('/') ? name.slice(0, name.lastIndexOf('/')) === parent : parent === ''
    return (
      <>
        {folders.filter(within).map((folder) => (
          <details key={folder} className="notes-tree-folder" open>
            <summary
              className={selectedFolder === folder ? 'selected' : ''}
              onClick={() => onFolder(folder)}
              title={folder}
            >
              <FolderIcon size={14} />
              <span>{folder.split('/').at(-1)}</span>
            </summary>
            <div className="notes-tree-children">{branch(folder)}</div>
          </details>
        ))}
        {notes
          .filter((note) => within(note.path))
          .map((note) => (
            <button
              key={note.path}
              className="notes-tree-file"
              aria-current={active === note.path ? 'page' : undefined}
              disabled={disabled}
              title={note.path}
              onClick={() => onOpen(note.path)}
            >
              <FileIcon size={14} />
              <span>{note.path.split('/').at(-1)}</span>
            </button>
          ))}
      </>
    )
  }
  return <div className="notes-tree">{branch('')}</div>
}
