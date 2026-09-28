import type { SidebarSizeState } from '@sisyphus/ui'

const KEY = 'sisyphus.chat.sidebar.v1'

/**
 * Dockview unmounts hidden panels, so the sidebar size is cached locally to
 * survive block switches. Anything unreadable falls back to hook defaults.
 */
export function readSidebarState(): SidebarSizeState | undefined {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return undefined
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return undefined
    const { width, open } = value as { width?: unknown; open?: unknown }
    return typeof width === 'number' && typeof open === 'boolean' ? { width, open } : undefined
  } catch {
    return undefined
  }
}

export function writeSidebarState(state: SidebarSizeState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // Storage can be unavailable; the sidebar still works for this session.
  }
}
