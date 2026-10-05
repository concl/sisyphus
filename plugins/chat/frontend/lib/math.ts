/**
 * The math Streamdown typesets with, and the stylesheet that goes with it.
 *
 * `@streamdown/math` pairs remark-math, which finds the math in a reply, with
 * rehype-katex, which sets it the way the rest of the web sets LaTeX. Three
 * things differ from the defaults:
 *
 * - a single `$` counts as math, because a model writing inline math writes
 *   `$x$`. The cost is Pandoc's, and it is worth knowing: `$5 and $10` reads as
 *   math too;
 * - `\(...\)` and `\[...\]` are rewritten into dollar form by `texDelimiters`
 *   before the Markdown parser runs, since the parser eats the backslash;
 * - KaTeX's own stylesheet is imported here, with the plugin it belongs to. It
 *   carries its fonts, which the app inlines as data URLs because a plugin
 *   stylesheet has no URL space to serve them from.
 */
import 'katex/dist/katex.min.css'
import { createMathPlugin } from '@streamdown/math'
import type { MathPlugin } from 'streamdown'

/** What Streamdown takes as its `math` plugin: remark-math in, KaTeX out. */
export const math: MathPlugin = createMathPlugin({
  singleDollarTextMath: true,
  errorColor: 'var(--danger)',
})

export { texDelimiters } from './tex-delimiters'
