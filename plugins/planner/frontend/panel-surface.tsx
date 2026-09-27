import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Icon } from './icons'

/** Local to its Calendar panel. Other workspace panels remain interactive.
 * No native showModal(), global focus trap, body portal or document-wide inert.
 * The owning Calendar makes only its own underlying frame inert while open
 * and restores the invoker when the entire surface flow closes.
 */
export function PanelSurface({
  title,
  children,
  close,
  busy = false,
  compact = false,
  dismissOnBackdrop = false,
}: {
  title: string
  children: ReactNode
  close: () => void
  busy?: boolean
  compact?: boolean
  dismissOnBackdrop?: boolean
}) {
  const titleId = useId()
  const surface = useRef<HTMLElement>(null)
  useEffect(() => {
    const node = surface.current!
    const target =
      node.querySelector<HTMLElement>('[data-autofocus]') ||
      node.querySelector<HTMLElement>('button:not(:disabled)') ||
      node
    target.focus()
  }, [])
  return (
    <div
      className="cal-overlay"
      onPointerDown={(event) => {
        if (!busy && dismissOnBackdrop && event.target === event.currentTarget) close()
      }}
    >
      <section
        ref={surface}
        role="dialog"
        tabIndex={-1}
        aria-labelledby={titleId}
        aria-busy={busy}
        className={`cal-surface ${compact ? 'cal-surface-compact' : ''}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            event.preventDefault()
            if (!busy) close()
          }
        }}
      >
        <header className="cal-surface-header">
          <h2 id={titleId}>{title}</h2>
          <button
            className="cal-icon-button"
            type="button"
            title="Close"
            aria-label={`Close ${title.toLowerCase()}`}
            disabled={busy}
            onClick={close}
          >
            <Icon name="close" />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}
