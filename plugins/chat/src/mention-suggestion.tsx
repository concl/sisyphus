import { ReactRenderer } from '@tiptap/react'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'
import tippy, { type Instance } from 'tippy.js'
import type { FileEntry } from '@sisyphus/sdk'
import { mentionBridge, type MentionBridge } from './mention-bridge'
import { MentionList, type MentionListHandle, type MentionPick } from './mention-list'

/**
 * TipTap suggestion renderer: a React list positioned with tippy at the caret.
 * Keyboard handling is delegated to the list so Enter picks instead of sending,
 * and the shared bridge tells the composer to leave Enter alone while it is open.
 */
export function mentionSuggestion() {
  let renderer: ReactRenderer<MentionListHandle> | null = null
  let popup: Instance | null = null
  let bridge: MentionBridge | null = null
  const rect = (props: SuggestionProps<FileEntry, MentionPick>) =>
    (props.clientRect ?? undefined) as (() => DOMRect) | undefined

  return {
    onStart(props: SuggestionProps<FileEntry, MentionPick>) {
      bridge = mentionBridge(props.editor)
      bridge.suggesting = true
      renderer = new ReactRenderer(MentionList, {
        props: { ...props, hasFolder: bridge.hasFolder },
        editor: props.editor,
      })
      if (!props.clientRect) return
      popup = tippy(document.body, {
        getReferenceClientRect: rect(props),
        appendTo: () => document.body,
        content: renderer.element,
        showOnCreate: true,
        interactive: true,
        trigger: 'manual',
        placement: 'bottom-start',
        theme: 'chat',
        offset: [0, 6],
      })
    },
    onUpdate(props: SuggestionProps<FileEntry, MentionPick>) {
      renderer?.updateProps({ ...props, hasFolder: bridge?.hasFolder ?? false })
      if (props.clientRect) popup?.setProps({ getReferenceClientRect: rect(props) })
    },
    onKeyDown(props: SuggestionKeyDownProps) {
      if (props.event.key === 'Escape') {
        popup?.hide()
        return true
      }
      return renderer?.ref?.onKeyDown(props.event) ?? false
    },
    onExit() {
      if (bridge) bridge.suggesting = false
      popup?.destroy()
      renderer?.destroy()
      popup = null
      renderer = null
    },
  }
}
