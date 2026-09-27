import type { ReactNode } from 'react'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PanelLeftIcon,
  PlusIcon,
  FolderIcon,
} from '@sisyphus/ui'

export type IconName =
  | 'left'
  | 'right'
  | 'sidebar'
  | 'plus'
  | 'folder'
  | 'search'
  | 'close'
  | 'calendar'
  | 'tasks'
  | 'star'
  | 'more'
  | 'import'
  | 'export'
  | 'sync'
  | 'check'
  | 'clock'
  | 'arrow'
  | 'list'
  | 'chevron'
  | 'location'
  | 'repeat'
const paths: Partial<Record<IconName, ReactNode>> = {
  search: (
    <>
      <circle cx="7" cy="7" r="4.3" />
      <path d="m10.3 10.3 3.2 3.2" />
    </>
  ),
  close: <path d="m4 4 8 8M12 4l-8 8" />,
  calendar: (
    <>
      <rect x="2" y="3.5" width="12" height="10.5" rx="2" />
      <path d="M5 2v3M11 2v3M2 7h12M5 10h2" />
    </>
  ),
  tasks: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="m5 8 2 2 4-4" />
    </>
  ),
  star: <path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.5l-3.8 2.1.7-4.3-3.1-3 4.3-.6z" />,
  more: (
    <>
      <circle cx="3" cy="8" r=".8" fill="currentColor" />
      <circle cx="8" cy="8" r=".8" fill="currentColor" />
      <circle cx="13" cy="8" r=".8" fill="currentColor" />
    </>
  ),
  import: (
    <>
      <path d="M8 2v8m-3-3 3 3 3-3M3 10v3a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3" />
    </>
  ),
  export: (
    <>
      <path d="M8 10V2M5 5l3-3 3 3M3 10v3a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3" />
    </>
  ),
  sync: (
    <>
      <path d="M13 6a5.2 5.2 0 0 0-9-2L2 6m0-4v4h4M3 10a5.2 5.2 0 0 0 9 2l2-2m0 4v-4h-4" />
    </>
  ),
  check: <path d="m3 8 3 3 7-7" />,
  clock: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4v4l3 2" />
    </>
  ),
  arrow: <path d="M3 8h10M9 4l4 4-4 4" />,
  list: (
    <>
      <path d="M6 4h8M6 8h8M6 12h8M2 4h.5M2 8h.5M2 12h.5" />
    </>
  ),
  chevron: <path d="m4 6 4 4 4-4" />,
  location: (
    <>
      <path d="M12.5 6.5C12.5 10 8 14 8 14s-4.5-4-4.5-7.5a4.5 4.5 0 0 1 9 0Z" />
      <circle cx="8" cy="6.5" r="1.4" />
    </>
  ),
  repeat: (
    <>
      <path d="M12 3H5a3 3 0 0 0-3 3m8-5 2 2-2 2M4 13h7a3 3 0 0 0 3-3m-8 5-2-2 2-2" />
    </>
  ),
}
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const shared = {
    left: ChevronLeftIcon,
    right: ChevronRightIcon,
    sidebar: PanelLeftIcon,
    plus: PlusIcon,
    folder: FolderIcon,
  }
  if (name in shared) {
    const Component = shared[name as keyof typeof shared]
    return <Component size={size} />
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  )
}
