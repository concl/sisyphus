import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

export interface SidebarSizeState {
  /** Width in pixels while the sidebar is open. */
  width: number
  open: boolean
}

export interface SidebarSizeOptions {
  /** Width used when opening, including reopening after a snap-close. */
  defaultWidth?: number
  minWidth?: number
  maxWidth?: number
  /** Dragging narrower than this collapses the sidebar on release. */
  snapWidth?: number
  /** Space the content beside the sidebar always keeps. */
  minContentWidth?: number
  /** Restored size, for example from a cache. */
  initial?: SidebarSizeState
  /** Called once per settled change so callers can persist the size. */
  onChange?(state: SidebarSizeState): void
}

/** Spread onto the drag handle; the handle is keyboard operable as a separator. */
export interface SidebarHandleProps {
  role: 'separator'
  tabIndex: number
  'aria-orientation': 'vertical'
  'aria-label': string
  'aria-valuenow': number
  'aria-valuemin': number
  'aria-valuemax': number
  onPointerDown(event: PointerEvent<HTMLElement>): void
  onPointerMove(event: PointerEvent<HTMLElement>): void
  onPointerUp(event: PointerEvent<HTMLElement>): void
  onPointerCancel(event: PointerEvent<HTMLElement>): void
  onKeyDown(event: KeyboardEvent<HTMLElement>): void
}

export interface SidebarSize {
  width: number
  open: boolean
  resizing: boolean
  setOpen(open: boolean): void
  toggle(): void
  handleProps: SidebarHandleProps
}

const MIN_WIDTH = 176
const MAX_WIDTH = 420
const SNAP_WIDTH = 108
const KEYBOARD_STEP = 12
const KEYBOARD_STEP_LARGE = 32

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

/**
 * Width, open state, and drag behaviour for a resizable sidebar. Pointer moves
 * update immediately while a gesture is live; `onChange` only fires for settled
 * changes, which keeps persistence quiet during a drag.
 */
export function useSidebarSize(options: SidebarSizeOptions = {}): SidebarSize {
  const {
    defaultWidth = 236,
    minWidth = MIN_WIDTH,
    maxWidth = MAX_WIDTH,
    snapWidth = SNAP_WIDTH,
    minContentWidth = 200,
    initial,
    onChange,
  } = options

  const [state, setState] = useState<SidebarSizeState>(() => ({
    width: clamp(initial?.width ?? defaultWidth, minWidth, maxWidth),
    open: initial?.open ?? true,
  }))
  const [resizing, setResizing] = useState(false)
  // Every change flows through `apply`, so this ref always mirrors the state
  // and a gesture never works from a stale render.
  const live = useRef(state)
  const drag = useRef<{
    pointerId: number
    startX: number
    startWidth: number
    width: number
    maxWidth: number
  } | null>(null)

  const apply = useCallback((next: SidebarSizeState) => {
    live.current = next
    setState(next)
  }, [])

  const commit = useCallback(
    (next: SidebarSizeState) => {
      apply(next)
      onChange?.(next)
    },
    [apply, onChange],
  )

  const setOpen = useCallback(
    (open: boolean) => {
      const current = live.current
      if (current.open === open) return
      commit(
        open
          ? { width: current.width >= minWidth ? current.width : defaultWidth, open }
          : { ...current, open },
      )
    },
    [commit, defaultWidth, minWidth],
  )

  const toggle = useCallback(() => setOpen(!live.current.open), [setOpen])

  const limitAt = useCallback(
    (element: HTMLElement) => {
      // The handle lives inside the sidebar, so its layout parent is the panel
      // column that the sidebar shares with the content.
      const available = element.parentElement?.parentElement?.clientWidth ?? 0
      return available > 0
        ? Math.max(minWidth, Math.min(maxWidth, available - minContentWidth))
        : maxWidth
    },
    [maxWidth, minContentWidth, minWidth],
  )

  const handleProps: SidebarHandleProps = {
    role: 'separator',
    tabIndex: 0,
    'aria-orientation': 'vertical',
    'aria-label': 'Resize sidebar',
    'aria-valuenow': Math.round(state.width),
    'aria-valuemin': minWidth,
    'aria-valuemax': maxWidth,
    onPointerDown(event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      const element = event.currentTarget
      element.setPointerCapture(event.pointerId)
      drag.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: live.current.width,
        width: live.current.width,
        maxWidth: limitAt(element),
      }
      setResizing(true)
      event.preventDefault()
    },
    onPointerMove(event) {
      const active = drag.current
      if (!active || active.pointerId !== event.pointerId) return
      const width = clamp(active.startWidth + (event.clientX - active.startX), 0, active.maxWidth)
      active.width = width
      // Below the snap point the sidebar previews as closed; releasing there
      // commits the collapse, dragging back out keeps it open.
      apply({ width, open: width >= snapWidth })
    },
    onPointerUp(event) {
      const active = drag.current
      if (!active || active.pointerId !== event.pointerId) return
      drag.current = null
      setResizing(false)
      const element = event.currentTarget
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId)
      }
      if (active.width < snapWidth) commit({ width: defaultWidth, open: false })
      else commit({ width: clamp(active.width, minWidth, active.maxWidth), open: true })
    },
    onPointerCancel(event) {
      const active = drag.current
      if (!active || active.pointerId !== event.pointerId) return
      drag.current = null
      setResizing(false)
      commit({ width: clamp(active.startWidth, minWidth, maxWidth), open: true })
    },
    onKeyDown(event) {
      const current = live.current
      const step = event.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        if (!current.open) return setOpen(true)
        const width = current.width + (event.key === 'ArrowRight' ? step : -step)
        if (width < minWidth) return commit({ width: defaultWidth, open: false })
        commit({ width: clamp(width, minWidth, maxWidth), open: true })
      } else if (event.key === 'Home') {
        event.preventDefault()
        commit({ width: defaultWidth, open: true })
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        toggle()
      }
    },
  }

  return { width: state.width, open: state.open, resizing, setOpen, toggle, handleProps }
}
