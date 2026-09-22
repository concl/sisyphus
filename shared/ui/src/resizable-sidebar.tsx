import type { CSSProperties, ReactNode } from 'react'
import type { SidebarHandleProps } from './use-sidebar-size'
import './sidebar.css'

export interface ResizableSidebarProps {
  /** Open width in pixels. */
  width: number
  open: boolean
  /** True while the user is dragging the handle. */
  resizing?: boolean
  /** Overlay mode floats the sidebar above the content instead of pushing it. */
  overlay?: boolean
  /** Accessible name for the sidebar region. */
  label: string
  /** Drag handle behaviour from `useSidebarSize`; omitted in overlay mode. */
  handleProps?: SidebarHandleProps
  className?: string
  children: ReactNode
}

/**
 * Sidebar shell that owns the animated width and the drag handle. Pair it with
 * `useSidebarSize` for the state, and give the children their own flex layout:
 * the inner element keeps the open width so content clips instead of reflowing
 * while the sidebar collapses.
 */
export function ResizableSidebar({
  width,
  open,
  resizing = false,
  overlay = false,
  label,
  handleProps,
  className,
  children,
}: ResizableSidebarProps) {
  // While dragging, the measured width always applies so the sidebar follows the
  // pointer even when the gesture has already crossed the snap point.
  const style = {
    '--ui-sidebar-size': `${open || resizing ? width : 0}px`,
    '--ui-sidebar-open-size': `${width}px`,
  } as CSSProperties

  return (
    <aside
      className={className ? `ui-sidebar ${className}` : 'ui-sidebar'}
      style={style}
      data-open={open}
      data-resizing={resizing}
      data-overlay={overlay}
      aria-label={label}
      aria-hidden={!open}
    >
      {/* The clip layer costs the animated width; the inner element keeps the
          open width so content slides out of view instead of reflowing. */}
      <div className="ui-sidebar-clip">
        <div className="ui-sidebar-inner">{children}</div>
      </div>
      {handleProps && !overlay && <div className="ui-sidebar-handle" {...handleProps} />}
    </aside>
  )
}
