import type { ThreadSummary } from './types'
import { folderLabel } from './format'

/** Heading for conversations that are not bound to a folder yet. */
export const UNBOUND_LABEL = 'No folder'

/** One folder's conversations, as the sidebar draws them. */
export interface ThreadGroup {
  /** The folder every conversation here works in; null when none is bound. */
  folder: string | null
  /** The folder's own name, or the heading for conversations without one. */
  label: string
  /** The full path, set only when another folder shares the same name. */
  detail: string
  threads: ThreadSummary[]
}

/**
 * Groups the conversation list by folder without re-ordering it: the list
 * arrives newest first, so a group sits where its most recent conversation
 * does, and the conversations inside it keep that order.
 *
 * Two different folders can end in the same name - two checkouts both called
 * `app` - and a name on its own would not say which is which, so those groups
 * carry their path as a detail line.
 */
export function threadGroups(threads: ThreadSummary[]): ThreadGroup[] {
  const groups: ThreadGroup[] = []
  const byFolder = new Map<string, ThreadGroup>()
  const named = new Set<string>()
  const shared = new Set<string>()
  for (const thread of threads) {
    const folder = thread.folder ?? null
    let group = byFolder.get(folder ?? '')
    if (!group) {
      const label = folder ? folderLabel(folder) : UNBOUND_LABEL
      const name = label.toLowerCase()
      if (named.has(name)) shared.add(name)
      named.add(name)
      group = { folder, label, detail: '', threads: [] }
      byFolder.set(folder ?? '', group)
      groups.push(group)
    }
    group.threads.push(thread)
  }
  for (const group of groups)
    if (group.folder && shared.has(group.label.toLowerCase())) group.detail = group.folder
  return groups
}
