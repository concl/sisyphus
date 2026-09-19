import { useImperativeHandle, useState, type Ref } from 'react'
import type { FileEntry } from '@sisyphus/sdk'
import { FileIcon, FolderIcon } from '@sisyphus/ui'

export interface MentionPick {
  id: string
  label: string
}

export interface MentionListHandle {
  onKeyDown(event: KeyboardEvent): boolean
}

interface MentionListProps {
  items: FileEntry[]
  command(pick: MentionPick): void
  hasFolder: boolean
  ref?: Ref<MentionListHandle>
}

/**
 * Suggestion popup for `@` mentions. The highlight follows the chosen path, so
 * a new query (which produces new items) starts again at the first row.
 */
export function MentionList({ items, command, hasFolder, ref }: MentionListProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const found = items.findIndex((item) => item.path === selected)
  const index = found >= 0 ? found : 0

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown(event) {
        const pick = (item?: FileEntry) => {
          const chosen = item ?? items[index]
          if (chosen) command({ id: chosen.path, label: chosen.path })
        }
        if (!items.length) return event.key === 'Escape'
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          const step = event.key === 'ArrowDown' ? 1 : -1
          pick(items[(index + step + items.length) % items.length])
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          pick()
          return true
        }
        return event.key === 'Escape'
      },
    }),
    [items, index, command],
  )

  if (!items.length)
    return (
      <div className="chat-mentions">
        <p className="chat-mentions-empty">
          {hasFolder ? 'No matching files.' : 'Choose a folder to reference its files.'}
        </p>
      </div>
    )

  return (
    <div className="chat-mentions" role="listbox" aria-label="Files and folders">
      {items.map((item, position) => (
        <button
          key={item.path}
          type="button"
          role="option"
          aria-selected={position === index}
          className={position === index ? 'active' : undefined}
          onMouseEnter={() => setSelected(item.path)}
          onMouseDown={(event) => {
            // Keep focus in the editor so the suggestion stays open.
            event.preventDefault()
            command({ id: item.path, label: item.path })
          }}
        >
          {item.type === 'folder' ? <FolderIcon /> : <FileIcon />}
          <span>{item.path}</span>
        </button>
      ))}
    </div>
  )
}
