/**
 * The LaTeX delimiters a Markdown parser does not know, rewritten into the ones
 * it does.
 *
 * `$...$` and `$$...$$` are handed to remark-math as they are; `\(...\)` and
 * `\[...\]` are rewritten here, before parsing, because the parser eats the
 * backslash: a `\[` that reached remark-math as syntax would already be a plain
 * `[`. Rewriting the text rather than the syntax tree is also what keeps code out
 * of it - a fenced block and a code span are copied untouched, dollars, brackets
 * and backslashes alike.
 *
 * Display math is given lines of its own, because remark-math reads `$$...$$` as
 * a block - which is what makes KaTeX center it and set limits over and under
 * sums - only when the dollars stand alone on their lines. Math that sits inside
 * a sentence stays in that sentence and renders inline.
 */
const FENCE = /^ {0,3}(`{3,}|~{3,})/
/** What can stand beside display math on the lines it touches. */
const BLANK = /^[ \t]*$/

/** How many `char` start at `index`. */
function runLength(text: string, index: number, char: string): number {
  let length = 0
  while (text[index + length] === char) length += 1
  return length
}

/** Where the line holding `index` ends, without its newline. */
function lineEnd(text: string, index: number): number {
  const stop = text.indexOf('\n', index)
  return stop === -1 ? text.length : stop
}

/** Whether the lines `start` and `end` touch hold nothing but the math itself. */
function standsAlone(text: string, start: number, end: number): boolean {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  return BLANK.test(text.slice(lineStart, start)) && BLANK.test(text.slice(end, lineEnd(text, end)))
}

/** Whether a line closes the fenced block an opening `fence` began. */
function isClosingFence(line: string, fence: string): boolean {
  const trimmed = line.replace(/^ {0,3}/, '')
  const length = runLength(trimmed, 0, fence[0])
  return length >= fence.length && BLANK.test(trimmed.slice(length))
}

/** The index just past a fenced block, from the index its opening fence line ends. */
function fencedEnd(text: string, from: number, fence: string): number {
  let index = Math.min(from + 1, text.length)
  while (index < text.length) {
    const stop = lineEnd(text, index)
    if (isClosingFence(text.slice(index, stop), fence)) return Math.min(stop + 1, text.length)
    index = stop + 1
  }
  // An unclosed fence runs to the end of the document, as the Markdown parser says.
  return text.length
}

/** The index of the next run of exactly `length` backticks, closing a code span. */
function closingRun(text: string, from: number, length: number): number {
  let index = from
  while (index < text.length) {
    const found = text.indexOf('`', index)
    if (found === -1) return -1
    const run = runLength(text, found, '`')
    if (run === length) return found
    index = found + run
  }
  return -1
}

/** The math an unescaped backslash pair encloses, and the index just past its closer. */
function enclosed(
  text: string,
  from: number,
  closer: string,
): { value: string; end: number } | null {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] !== '\\') continue
    const run = runLength(text, index, '\\')
    // An odd run ends in the backslash of the closer; an even one is a literal
    // backslash and leaves the bracket beside it as plain text.
    if (run % 2 === 1 && text.startsWith(closer, index + run))
      return { value: text.slice(from, index), end: index + run + closer.length }
    index += run - 1
  }
  return null
}

/** A bare `$` inside dollars would close the math early, so it is escaped. */
const escaped = (tex: string) =>
  tex.replace(/(\\*)\$/g, (_match, backslashes: string) =>
    // An odd run of backslashes is already escaping the dollar.
    backslashes.length % 2 ? `${backslashes}$` : `${backslashes}\\$`,
  )

/** Math on a line of its own, without the indentation the line began with. */
const display = (written: string, tex: string) => `${written.replace(/[ \t]*$/, '')}$$\n${tex}\n$$`

/**
 * The text with `\(...\)` and `\[...\]` rewritten into `$...$` and `$$...$$`,
 * and with `$$...$$` given lines of its own where it stands alone. Everything
 * else, code included, is copied as it is.
 */
export function texDelimiters(text: string): string {
  let out = ''
  let index = 0
  while (index < text.length) {
    // A fenced block, whole: it is code, whatever it looks like inside.
    if (index === 0 || text[index - 1] === '\n') {
      const fence = FENCE.exec(text.slice(index, lineEnd(text, index)))
      if (fence) {
        const end = fencedEnd(text, lineEnd(text, index), fence[1])
        out += text.slice(index, end)
        index = end
        continue
      }
    }

    // A code span, whole, for the same reason.
    if (text[index] === '`') {
      const length = runLength(text, index, '`')
      const close = closingRun(text, index + length, length)
      const end = close === -1 ? index + length : close + length
      out += text.slice(index, end)
      index = end
      continue
    }

    // Display math written between dollars, standing on a line of its own: the
    // dollars already say display, and their own lines are what remark-math reads
    // as a block.
    if (text.startsWith('$$', index) && text[index + 2] !== '$') {
      const close = text.indexOf('$$', index + 2)
      if (close !== -1 && standsAlone(text, index, close + 2)) {
        out = display(out, escaped(text.slice(index + 2, close).trim()))
        index = close + 2
        continue
      }
    }

    // The backslash delimiters, which no plugin can see: by the time a plugin
    // runs, the parser has turned them into plain brackets.
    if (text[index] === '\\') {
      const run = runLength(text, index, '\\')
      const marker = text[index + run]
      if (run % 2 === 1 && (marker === '[' || marker === '(')) {
        const math = enclosed(text, index + run + 1, marker === '[' ? ']' : ')')
        const value = math?.value.trim()
        // A pair of backslashes is literal: an even run leaves the bracket as
        // plain text. What the odd run escapes is the delimiter itself.
        const literal = '\\'.repeat(run - 1)
        if (math && value) {
          if (marker === '(') out += `${literal}$${escaped(value)}$`
          // Display math is alone on its line, so nothing literal precedes it.
          else if (standsAlone(text, index, math.end)) out = display(out, escaped(value))
          else out += `${literal}$$${escaped(value)}$$`
          index = math.end
          continue
        }
      }
      // Anything else is text. An escaping backslash is copied with what it
      // escapes, so that a `\$` or a `` \` `` never reads as syntax.
      const end = run % 2 === 1 ? Math.min(index + run + 1, text.length) : index + run
      out += text.slice(index, end)
      index = end
      continue
    }

    out += text[index]
    index += 1
  }
  return out
}
