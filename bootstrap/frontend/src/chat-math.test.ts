import { describe, expect, it } from 'vitest'
import { texDelimiters } from '../../../plugins/chat/frontend/lib/tex-delimiters'

describe('tex delimiters', () => {
  it('turns a backslash pair into inline math', () => {
    expect(texDelimiters('cost is \\( 2x \\) today')).toBe('cost is $2x$ today')
  })

  it('gives display math its own lines, which is what makes it display', () => {
    expect(texDelimiters('\\[ \\frac{1}{2} \\]')).toBe('$$\n\\frac{1}{2}\n$$')
    expect(texDelimiters('  \\[ x \\]  ')).toBe('$$\nx\n$$  ')
    expect(texDelimiters('\\[\n\\sum_{i=1}^n i\n\\]')).toBe('$$\n\\sum_{i=1}^n i\n$$')
    expect(texDelimiters('We have\n\\[ x \\]\nholds.')).toBe('We have\n$$\nx\n$$\nholds.')
  })

  it('leaves display math inside a sentence in that sentence', () => {
    expect(texDelimiters('so \\[ x \\] holds')).toBe('so $$x$$ holds')
    expect(texDelimiters('sum \\( a \\) then \\[ b \\]')).toBe('sum $a$ then $$b$$')
  })

  it('stands dollars on their own lines too, since a single line is inline to the parser', () => {
    expect(texDelimiters('$$x$$')).toBe('$$\nx\n$$')
    expect(texDelimiters('before\n$$\n\\int_0^1 x\\,dx\n$$\nafter')).toBe(
      'before\n$$\n\\int_0^1 x\\,dx\n$$\nafter',
    )
    // In a sentence they are inline math, and are left where they are.
    expect(texDelimiters('a $$x$$ b')).toBe('a $$x$$ b')
  })

  it('leaves what is not a pair alone, so a stream can still finish it', () => {
    expect(texDelimiters('\\( x')).toBe('\\( x')
    expect(texDelimiters('\\[ x')).toBe('\\[ x')
    expect(texDelimiters('\\[ \\]')).toBe('\\[ \\]')
  })

  it('edges a dollar that would otherwise close the math early', () => {
    expect(texDelimiters('\\( a = $5 \\)')).toBe('$a = \\$5$')
    expect(texDelimiters('\\( \\$5 \\)')).toBe('$\\$5$')
    // An even run of backslashes stays the literal backslash it is, and the bare
    // `$` after it is escaped for the single-dollar form it is about to sit in.
    const literal = String.raw`\\`
    const dollar = String.raw`\$`
    expect(texDelimiters(String.raw`\( 5 \\$ \)`)).toBe(`$5 ${literal}${dollar}$`)
  })

  it('keeps code as it was written', () => {
    expect(texDelimiters('```\n\\[ x \\]\n$$y$$\n```')).toBe('```\n\\[ x \\]\n$$y$$\n```')
    expect(texDelimiters('~~~\n\\[ x \\]\n~~~')).toBe('~~~\n\\[ x \\]\n~~~')
    expect(texDelimiters('a `$x$` and `\\( y \\)` b')).toBe('a `$x$` and `\\( y \\)` b')
    expect(texDelimiters('``a `b` \\[ x \\]``')).toBe('``a `b` \\[ x \\]``')
    // A fence that never closes is code to the end, as the parser reads it.
    expect(texDelimiters('```\n\\[ x \\]')).toBe('```\n\\[ x \\]')
  })

  it('reads an escaped backslash as text', () => {
    expect(texDelimiters('\\\\[ x \\\\]')).toBe('\\\\[ x \\\\]')
    expect(texDelimiters('\\\\( x \\\\)')).toBe('\\\\( x \\\\)')
    // Odd run: the pairs are literal, and the last backslash still opens math.
    expect(texDelimiters('\\\\\\( x \\)')).toBe('\\\\$x$')
  })

  it('leaves ordinary text, and the delimiters remark-math owns, untouched', () => {
    expect(texDelimiters('An array [1, 2] and a price $5')).toBe('An array [1, 2] and a price $5')
    expect(texDelimiters('a $x$ b')).toBe('a $x$ b')
    expect(texDelimiters('a \\( b [c] d \\)')).toBe('a $b [c] d$')
  })
})
