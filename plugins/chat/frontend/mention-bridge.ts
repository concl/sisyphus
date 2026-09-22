import type { Editor } from '@tiptap/react'
import type { FileEntry } from '@sisyphus/sdk'

/**
 * Values the `@` suggestion needs while the editor is alive. TipTap creates the
 * editor once, so the composer and the popup share this small record instead of
 * closing over props that would go stale.
 */
export interface MentionBridge {
  /** Resolves files for the picker, already scoped to the conversation folder. */
  items(query: string): Promise<FileEntry[]>
  hasFolder: boolean
  /** True while the popup is open, so Enter picks instead of sending. */
  suggesting: boolean
}

const bridges = new WeakMap<Editor, MentionBridge>()

export function mentionBridge(editor: Editor): MentionBridge {
  const existing = bridges.get(editor)
  if (existing) return existing
  const created: MentionBridge = { items: async () => [], hasFolder: false, suggesting: false }
  bridges.set(editor, created)
  return created
}
