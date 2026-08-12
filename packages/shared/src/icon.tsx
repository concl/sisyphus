interface IconProps {
  name: string
  className?: string
}

/**
 * Renders an icon from the app's inline SVG sprite. The sprite is an
 * app-level asset (inlined into the document by the frontend's main.tsx);
 * this component only emits the `<use>` reference against it.
 */
export function Icon({ name, className }: IconProps) {
  return (
    <svg className={className} role="presentation" aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  )
}
