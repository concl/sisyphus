interface IconProps {
  /** Inline SVG markup (e.g. an icon.svg imported `?raw`, or fetched from an
   * extension's store dir). The extension owns its icon; there is no
   * app-level sprite. */
  svg: string
  className?: string
}

/** Parses inline SVG markup and drops anything unsafe (scripts, handlers). */
function parseIcon(markup: string): { attrs: Record<string, string>; inner: string } {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const root = doc.documentElement
  if (root.nodeName.toLowerCase() !== 'svg') return { attrs: {}, inner: '' }
  root.querySelectorAll('script, foreignObject').forEach((el) => el.remove())
  for (const el of root.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith('on')) el.removeAttribute(attr.name)
    }
  }
  const attrs: Record<string, string> = {}
  for (const attr of root.attributes) attrs[attr.name] = attr.value
  // Size comes from CSS classes, not the markup.
  delete attrs.width
  delete attrs.height
  return { attrs, inner: root.innerHTML }
}

/**
 * Renders an extension-owned icon from inline SVG markup. Presentation
 * attributes (viewBox, fill/stroke, …) are carried over from the markup's
 * root <svg> element, so `currentColor` icons inherit the surrounding text
 * color as before.
 */
export function Icon({ svg, className }: IconProps) {
  const { attrs, inner } = parseIcon(svg)
  return (
    <svg
      {...attrs}
      className={className}
      role="presentation"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  )
}
