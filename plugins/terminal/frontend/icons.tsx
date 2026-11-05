import type { ReactNode } from 'react'

function Glyph({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export function PlusIcon() {
  return (
    <Glyph>
      <path d="M8 2.5v11M2.5 8h11" />
    </Glyph>
  )
}
export function ChevronIcon() {
  return (
    <Glyph size={12}>
      <path d="m4 6 4 4 4-4" />
    </Glyph>
  )
}
export function RestartIcon() {
  return (
    <Glyph>
      <path d="M3 6a5.2 5.2 0 1 1 .7 5.5M3 2.5V6h3.5" />
    </Glyph>
  )
}
export function TrashIcon() {
  return (
    <Glyph>
      <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.6 9.5h6.8L12 4M6.5 6.5v4.5M9.5 6.5v4.5" />
    </Glyph>
  )
}
export function CheckIcon() {
  return (
    <Glyph>
      <path d="m3.5 8 3 3 6-6" />
    </Glyph>
  )
}
export function AlertIcon() {
  return (
    <Glyph>
      <path d="m8 2 6 11H2L8 2ZM8 6v3M8 11h.01" />
    </Glyph>
  )
}
export function ShellIcon({ shell }: { shell?: string }) {
  if (shell === 'powershell' || shell === 'pwsh')
    return (
      <Glyph>
        <path d="M4 3h10l-2 10H2L4 3Z" />
        <path d="m6 5.5 3 2-4 3M8.5 10.5H11" />
      </Glyph>
    )
  if (shell === 'cmd')
    return (
      <Glyph>
        <rect x="1.5" y="3" width="13" height="10" rx="1" />
        <path d="m4 6 2.5 2L4 10M8.5 10h3" />
      </Glyph>
    )
  return (
    <Glyph>
      <path d="m3 4 4 4-4 4M9 12h4" />
    </Glyph>
  )
}
