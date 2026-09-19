import { useEffect, useImperativeHandle, useState, type Ref } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Mention from '@tiptap/extension-mention'
import { Placeholder } from '@tiptap/extensions/placeholder'
import type { ChatConfig, FileEntry } from '@sisyphus/sdk'
import { mentionBridge } from './mention-bridge'
import { mentionSuggestion } from './mention-suggestion'

const MAX_LENGTH = 20000

export interface ChatComposerHandle {
  clear(): void
  insert(text: string): void
  insertFiles(paths: string[]): void
  focus(): void
}

interface ChatComposerProps {
  ref?: Ref<ChatComposerHandle>
  config: ChatConfig | null
  busy: boolean
  /** Whether this conversation has a folder the @ picker can list. */
  hasFolder: boolean
  /** Resolves files for the @ picker, scoped to the conversation folder. */
  mentionItems(query: string): Promise<FileEntry[]>
  onSubmit(text: string): void
  onStop(): void
  onDropFiles(files: File[]): void
}

/**
 * Message box built on TipTap so `@` can reference files with real mention
 * nodes. Mentions serialize back to `@path` text, which is what the model sees.
 */
export function ChatComposer({
  ref,
  config,
  busy,
  hasFolder,
  mentionItems,
  onSubmit,
  onStop,
  onDropFiles,
}: ChatComposerProps) {
  const [empty, setEmpty] = useState(true)
  const [dragging, setDragging] = useState(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bulletList: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        listItem: false,
        orderedList: false,
      }),
      Placeholder.configure({ placeholder: 'Message Sisyphus…' }),
      Mention.configure({
        // Without an explicit class the rendered chip is unstyled.
        HTMLAttributes: { class: 'chat-mention' },
        suggestion: {
          char: '@',
          items: ({ editor: instance, query }) => mentionBridge(instance).items(query),
          render: () => mentionSuggestion(),
        },
        // `getText()` turns a mention back into readable `@path` for the model.
        renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
      }),
    ],
    editorProps: {
      attributes: {
        class: 'chat-editor',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Chat message',
      },
    },
    onUpdate: ({ editor: instance }) => setEmpty(instance.isEmpty),
  })

  useEffect(() => {
    if (!editor) return
    const bridge = mentionBridge(editor)
    bridge.items = mentionItems
    bridge.hasFolder = hasFolder
  }, [editor, mentionItems, hasFolder])

  function send() {
    const text = (editor?.getText({ blockSeparator: '\n' }) ?? '').trim()
    if (!text || text.length > MAX_LENGTH) return
    onSubmit(text)
  }

  useImperativeHandle(
    ref,
    () => ({
      clear: () => { if (editor && !editor.isDestroyed) editor.commands.clearContent(true) },
      insert: (text: string) => {
        editor?.chain().focus().insertContent(text).run()
      },
      insertFiles: (paths: string[]) => {
        const content = paths.flatMap((path) => [
          { type: 'mention', attrs: { id: path, label: path } },
          { type: 'text', text: ' ' },
        ])
        editor?.chain().focus().insertContent(content).run()
      },
      focus: () => editor?.commands.focus(),
    }),
    [editor],
  )

  return (
    <form
      className="chat-composer"
      data-dragging={dragging}
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes('Files')) setDragging(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDropCapture={(event) => {
        const files = Array.from(event.dataTransfer.files)
        if (!files.length) return
        event.preventDefault()
        event.stopPropagation()
        setDragging(false)
        onDropFiles(files)
      }}
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
      onKeyDown={(event) => {
        // Enter sends, unless the @ popup is open or a line break is wanted.
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
        if (!editor || mentionBridge(editor).suggesting) return
        event.preventDefault()
        send()
      }}
    >
      {dragging && <div className="chat-drop-target">Drop to mention in this chat</div>}
      <EditorContent editor={editor} />
      <div className="chat-composer-footer">
        <span title={config?.baseURL}>
          {config?.model || 'No model configured'}
          <b>·</b>
          {config?.access === 'write'
            ? 'Files and commands on'
            : config?.access === 'read'
              ? 'Files read-only'
              : 'Tools off'}
        </span>
        {busy ? (
          <button type="button" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button className="primary" type="submit" disabled={empty || !config?.model}>
            Send ↑
          </button>
        )}
      </div>
    </form>
  )
}
