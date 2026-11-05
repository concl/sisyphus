import type { Settings, SettingsSection } from '@sisyphus/sdk'

export function createSettings(): Settings {
  let sections: readonly SettingsSection[] = []
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())
  return {
    getSnapshot: () => sections,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    register(section) {
      if (!section.id.trim() || !section.title.trim() || !section.category.trim())
        throw new Error('Settings sections require an ID, title, and category.')
      if (sections.some((item) => item.id === section.id))
        throw new Error(`Duplicate settings section: ${section.id}`)
      sections = [...sections, section].sort(
        (a, b) =>
          (a.order ?? 100) - (b.order ?? 100) ||
          a.category.localeCompare(b.category) ||
          a.title.localeCompare(b.title),
      )
      notify()
      return () => {
        if (!sections.includes(section)) return
        sections = sections.filter((item) => item !== section)
        notify()
      }
    },
  }
}

export function searchSections(sections: readonly SettingsSection[], query: string) {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  return sections.filter((section) => {
    const text = [section.title, section.category, section.description, ...(section.keywords ?? [])]
      .join(' ')
      .toLocaleLowerCase()
    return words.every((word) => text.includes(word))
  })
}
