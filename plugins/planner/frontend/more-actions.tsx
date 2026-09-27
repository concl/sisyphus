import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Icon, type IconName } from './icons'
import type { TransferMode } from './transfer-dialog'

export function MoreActions({ choose }: { choose: (mode: TransferMode) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    }
    if (event.key === 'Tab') setOpen(false)
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const items = [...root.current!.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    const index = items.indexOf(document.activeElement as HTMLElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }
  const entries: { mode: TransferMode; label: string; icon: IconName }[] = [
    { mode: 'import', label: 'Import .ics file', icon: 'import' },
    { mode: 'export', label: 'Export calendar', icon: 'export' },
    { mode: 'sync', label: 'Folder sync', icon: 'sync' },
  ]
  return (
    <div ref={root} className="cal-more-actions" onKeyDown={keys}>
      <button
        ref={trigger}
        className="cal-icon-button"
        aria-label="Calendar options"
        title="Calendar options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div role="menu" aria-label="Calendar options" className="cal-options-menu">
          {entries.map((entry) => (
            <button
              role="menuitem"
              key={entry.mode}
              onClick={() => {
                setOpen(false)
                trigger.current?.focus()
                choose(entry.mode)
              }}
            >
              <Icon name={entry.icon} size={17} />
              {entry.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
