export interface Note {
  path: string
  title: string
  revision: string
  modified: string
  tags: string[]
  links: string[]
  excerpt: string
}
export interface Document extends Note {
  content: string
}
export interface Listing {
  folder: string
  folders: string[]
  projects: string[]
  notes: Note[]
  warnings: string[]
}

export function resolveLink(link: string, from: string, notes: Note[]) {
  const name = link.split('|')[0].split('#')[0].trim().replace(/\.md$/i, '')
  const folder = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : ''
  const same = (value: string, target: string) =>
    value.toLocaleLowerCase() === target.toLocaleLowerCase()
  const exact =
    notes.find((note) => same(note.path, `${name}.md`)) ??
    notes.find((note) => same(note.path, `${folder}${name}.md`))
  if (exact) return exact.path
  const matches = notes.filter((note) => same(note.title, name))
  return matches.length === 1 ? matches[0].path : null
}

// Keep wiki syntax literal in fenced and inline code. Raw HTML is disabled by the renderer.
export function previewMarkdown(content: string) {
  return content
    .split(/(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g)
    .map((part, index) =>
      index % 2
        ? part
        : part.replace(/\[\[([^\]\n]+)\]\]/g, (_, value: string) => {
            const [target, alias] = value.split('|')
            return `[${(alias || target).replace(/[[\]\\]/g, '\\$&')}](#note=${encodeURIComponent(target).replaceAll('(', '%28').replaceAll(')', '%29')})`
          }),
    )
    .join('')
}
