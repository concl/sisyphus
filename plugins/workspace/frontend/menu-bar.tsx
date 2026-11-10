import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

type MenuItem = {
  id?: string
  label: string
  run: () => void
  shortcut?: string
  separatorBefore?: boolean
}

export type WorkspaceMenu = { label: string; items: MenuItem[] }

export function MenuBar({ menus }: { menus: WorkspaceMenu[] }) {
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const triggers = useRef<(HTMLButtonElement | null)[]>([])
  const focusLast = useRef(false)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const items = popup.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    if (items?.length) items[focusLast.current ? items.length - 1 : 0].focus()
    focusLast.current = false
  }, [active, open])

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  function close() {
    setOpen(false)
    triggers.current[active]?.focus()
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const { key } = event
    if (key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (key === 'Tab' && open) {
      close()
    } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault()
      const step = key === 'ArrowRight' ? 1 : -1
      const next = (active + step + menus.length) % menus.length
      setActive(next)
      if (!open) triggers.current[next]?.focus()
    } else if (!open && (key === 'ArrowDown' || key === 'ArrowUp')) {
      event.preventDefault()
      focusLast.current = key === 'ArrowUp'
      setOpen(true)
    } else if (
      key === 'Home' ||
      key === 'End' ||
      (open && (key === 'ArrowDown' || key === 'ArrowUp'))
    ) {
      event.preventDefault()
      const items = open
        ? Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
        : triggers.current
      if (!items.length) return
      const current = items.indexOf(document.activeElement as HTMLButtonElement)
      const step = key === 'ArrowDown' ? 1 : -1
      const next =
        key === 'Home'
          ? 0
          : key === 'End'
            ? items.length - 1
            : (current + step + items.length) % items.length
      if (!open) setActive(next)
      items[next]?.focus()
    }
  }

  return (
    <div
      className="workspace-menubar"
      role="menubar"
      aria-label="Application menu"
      ref={root}
      onKeyDown={navigate}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      {menus.map(({ label, items }, index) => {
        const expanded = open && index === active
        const triggerId = `${id}-${index}`
        return (
          <div className="workspace-menu-entry" role="none" key={label}>
            <button
              type="button"
              id={triggerId}
              ref={(button) => {
                triggers.current[index] = button
              }}
              role="menuitem"
              tabIndex={active === index ? 0 : -1}
              aria-haspopup="menu"
              aria-expanded={expanded}
              aria-controls={expanded ? `${triggerId}-menu` : undefined}
              className="workspace-menu-trigger"
              onPointerEnter={() => {
                if (open) setActive(index)
              }}
              onClick={() => {
                setActive(index)
                setOpen(!expanded)
              }}
            >
              {label}
            </button>
            {expanded && (
              <div
                className="workspace-dropdown"
                ref={popup}
                role="menu"
                id={`${triggerId}-menu`}
                aria-labelledby={triggerId}
              >
                {items.map((item) => (
                  <Fragment key={item.id ?? item.label}>
                    {item.separatorBefore && <hr role="separator" />}
                    <button
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      onClick={() => {
                        close()
                        item.run()
                      }}
                    >
                      {item.label}
                      {item.shortcut && <kbd>{item.shortcut}</kbd>}
                    </button>
                  </Fragment>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
