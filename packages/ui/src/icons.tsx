// Shared chrome glyphs. Inline SVG keeps block panels free of an icon font or
// sprite dependency, and every icon inherits `currentColor` for theming.
export interface IconProps {
  /** Rendered size in pixels. */
  size?: number
}

export function ChevronLeftIcon({ size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9.8 3.6 5.9 8l3.9 4.4" />
    </svg>
  )
}

export function ChevronRightIcon({ size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6.2 3.6 10.1 8l-3.9 4.4" />
    </svg>
  )
}

export function PanelLeftIcon({ size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.9" y="2.9" width="12.2" height="10.2" rx="2.3" />
      <path d="M6.4 3.1v9.8" />
    </svg>
  )
}

export function PlusIcon({ size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 3.4v9.2M3.4 8h9.2" />
    </svg>
  )
}

export function FolderIcon({ size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 5.1c0-.9.7-1.6 1.6-1.6h2.3l1.5 1.8h5c.9 0 1.6.7 1.6 1.6v4.5c0 .9-.7 1.6-1.6 1.6H3.6c-.9 0-1.6-.7-1.6-1.6z" />
    </svg>
  )
}

export function FileIcon({ size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4.2 2.6h4.4l3.2 3.2v7.6H4.2z" />
      <path d="M8.5 2.7v3.3h3.2" />
    </svg>
  )
}
