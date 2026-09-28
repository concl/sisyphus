/**
 * Syntax highlighting for fenced code blocks in assistant replies.
 *
 * Streamdown renders Markdown and takes a `code` plugin: something that turns a
 * fenced block into coloured tokens. The official integration is the
 * `@streamdown/code` package, but it builds Shiki's *full* highlighter, which
 * carries every bundled grammar (~200 languages) plus the Oniguruma WASM the JS
 * engine never uses. This app compiles each plugin's entry at runtime, keeps the
 * result in memory and sends it to the window, so that price is paid on every
 * chat mount: the chat entry grows from ~2.3 MB to ~11.7 MB.
 *
 * So this is the same plugin shape `@streamdown/code` returns - the interface is
 * part of Streamdown's public types - built on `shiki/core` with the JavaScript
 * regex engine (no WASM) and a chosen list of languages. Adding a language is one
 * import and one array entry. The chat entry lands near 4.7 MB; swapping back to
 * `createCodePlugin()` from `@streamdown/code` is a one-line change if every
 * language is wanted instead.
 */
import { createHighlighterCore, type HighlighterCore, type LanguageRegistration } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import type { CodeHighlighterPlugin, HighlightOptions, ThemeInput } from 'streamdown'
import javascript from 'shiki/langs/javascript.mjs'
import typescript from 'shiki/langs/typescript.mjs'
import tsx from 'shiki/langs/tsx.mjs'
import jsx from 'shiki/langs/jsx.mjs'
import json from 'shiki/langs/json.mjs'
import html from 'shiki/langs/html.mjs'
import css from 'shiki/langs/css.mjs'
import markdown from 'shiki/langs/markdown.mjs'
import python from 'shiki/langs/python.mjs'
import bash from 'shiki/langs/bash.mjs'
import sql from 'shiki/langs/sql.mjs'
import yaml from 'shiki/langs/yaml.mjs'
import go from 'shiki/langs/go.mjs'
import rust from 'shiki/langs/rust.mjs'
import java from 'shiki/langs/java.mjs'
import c from 'shiki/langs/c.mjs'
import cpp from 'shiki/langs/cpp.mjs'
import csharp from 'shiki/langs/csharp.mjs'
import php from 'shiki/langs/php.mjs'
import ruby from 'shiki/langs/ruby.mjs'
import kotlin from 'shiki/langs/kotlin.mjs'
import swift from 'shiki/langs/swift.mjs'
import toml from 'shiki/langs/toml.mjs'
import diff from 'shiki/langs/diff.mjs'
import dockerfile from 'shiki/langs/dockerfile.mjs'
import xml from 'shiki/langs/xml.mjs'
import githubLight from 'shiki/themes/github-light.mjs'
import githubDark from 'shiki/themes/github-dark.mjs'

/** One coloured run of a line, in the shape Streamdown renders into a span. */
interface Token {
  content: string
  color?: string
  bgColor?: string
  htmlStyle?: Record<string, string>
  htmlAttrs?: Record<string, string>
}
/** A highlighted block: what Streamdown reads to colour and draw the lines. */
interface Highlighted {
  tokens: Token[][]
  bg?: string
  fg?: string
  rootStyle?: string | false
}

// Each grammar module is a list of registrations, and aliases come with them, so
// `ts`, `py`, `sh`, `c++` and the rest resolve without a table of our own.
const grammars: LanguageRegistration[] = [
  javascript,
  typescript,
  tsx,
  jsx,
  json,
  html,
  css,
  markdown,
  python,
  bash,
  sql,
  yaml,
  go,
  rust,
  java,
  c,
  cpp,
  csharp,
  php,
  ruby,
  kotlin,
  swift,
  toml,
  diff,
  dockerfile,
  xml,
].flat()

const themes: [typeof githubLight, typeof githubDark] = [githubLight, githubDark]

// The JS engine is slower than Oniguruma but ships no WASM and needs no loader;
// `forgiving` lets a grammar's stricter patterns fail softly instead of throwing.
const engine = createJavaScriptRegexEngine({ forgiving: true })
let pending: Promise<HighlighterCore> | null = null
const highlighter = () => (pending ??= createHighlighterCore({ langs: grammars, themes, engine }))

const nameOf = (theme: ThemeInput) => (typeof theme === 'string' ? theme : theme.name ?? 'custom')
const names = new Set(grammars.map((grammar) => grammar.name))
const aliases = new Map(
  grammars.flatMap((grammar) => (grammar.aliases ?? []).map((alias) => [alias, grammar.name])),
)
const normalize = (language: string) => {
  const value = language.trim().toLowerCase()
  return aliases.get(value) ?? value
}

/** An unknown or unlabelled fence is shown as it is, in the theme's body colour. */
const plain = (text: string): Highlighted => ({
  tokens: text.split('\n').map((line) => [{ content: line }]),
})

const results = new Map<string, Highlighted>()
const waiting = new Map<string, Set<(result: Highlighted) => void>>()

export const code: CodeHighlighterPlugin = {
  name: 'shiki',
  type: 'code-highlighter',
  getThemes: () => themes,
  getSupportedLanguages: () => [...names],
  supportsLanguage: (language) => names.has(normalize(language)),
  highlight({ code: source, language, themes: chosen }: HighlightOptions, callback) {
    const lang = normalize(language)
    const pair: [string, string] = [nameOf(chosen[0]), nameOf(chosen[1])]
    // The same block is highlighted twice per render (the reply, and again when a
    // stream tick re-renders it), so results are remembered by source and themes.
    const id = `${lang}:${pair[0]}:${pair[1]}:${source}`
    const remembered = results.get(id)
    if (remembered) return remembered
    if (callback) {
      if (!waiting.has(id)) waiting.set(id, new Set())
      waiting.get(id)?.add(callback)
    }
    // The first call returns null while Shiki loads; Streamdown re-renders when
    // the callback lands. Late callbacks for a block that scrolled away are
    // harmless, so nothing here cancels them.
    const known = names.has(lang) ? lang : null
    highlighter()
      .then((built) => {
        const result = known
          ? (built.codeToTokens(source, {
              lang: known,
              themes: { light: pair[0], dark: pair[1] },
            }) as Highlighted)
          : plain(source)
        results.set(id, result)
        for (const notify of waiting.get(id) ?? []) notify(result)
        waiting.delete(id)
      })
      .catch(() => {
        for (const notify of waiting.get(id) ?? []) notify(plain(source))
        waiting.delete(id)
      })
    return null
  },
}
