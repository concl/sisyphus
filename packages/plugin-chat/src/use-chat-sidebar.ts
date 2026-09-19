import { useEffect, useRef, useState } from 'react'
import { useSidebarSize } from '@sisyphus/ui'
import { readSidebarState, writeSidebarState } from './sidebar-state'

/** Below this panel width the sidebar overlays the conversation instead of pushing it. */
const COMPACT_WIDTH = 620

/**
 * Sidebar behaviour for the chat block: size and drag state from the shared
 * hook, plus the compact-mode switch. In compact mode the sidebar overlays the
 * conversation, so it starts closed and closes again after a selection.
 */
export function useChatSidebar() {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [compact, setCompact] = useState(false)
  const narrow = useRef(false)
  const sidebar = useSidebarSize({
    defaultWidth: 236,
    minWidth: 176,
    maxWidth: 380,
    snapWidth: 108,
    initial: readSidebarState(),
    onChange: writeSidebarState,
  })
  const { setOpen, open } = sidebar

  useEffect(() => {
    const element = rootRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const tight = entries[0].contentRect.width < COMPACT_WIDTH
      if (tight === narrow.current) return
      narrow.current = tight
      setCompact(tight)
      setOpen(!tight)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [setOpen])

  useEffect(() => {
    if (!compact || !open) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [compact, open, setOpen])

  return { rootRef, compact, sidebar }
}
