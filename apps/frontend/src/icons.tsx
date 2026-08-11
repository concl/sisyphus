interface IconProps {
  name: string
  className?: string
}

/**
 * Renders an icon from the SVG sprite (src/assets/icons.svg), which main.tsx
 * inlines into the document. Replace a <symbol> in that file to swap an icon.
 */
export function Icon({ name, className }: IconProps) {
  return (
    <svg className={className} role="presentation" aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  )
}
