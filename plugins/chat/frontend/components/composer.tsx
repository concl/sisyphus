import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Mention from '@tiptap/extension-mention'
import { Placeholder } from '@tiptap/extensions/placeholder'
import { FileIcon } from '@sisyphus/ui'
import { readable, type ChatAttachmentInput, type ChatConfig, type FileEntry } from '@sisyphus/sdk'
import { MAX_ATTACHMENTS, extensionOf, readAttachments } from '../lib/attachments'
import { mentionBridge } from '../lib/mention-bridge'
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
  onSubmit(text: string, attachments: ChatAttachmentInput[]): void
  onSelectModel(provider: string, model: string): Promise<void>
  onStop(): void
  onDropFiles(files: File[]): void
}

/** A paperclip drawn here rather than shared: only this panel uses one. */
function PaperclipIcon() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M21.4 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  )
}

/**
 * Message box built on TipTap so `@` can reference files with real mention
 * nodes. Mentions serialize back to `@path` text, which is what the model sees.
 *
 * Pictures and files ride beside the text instead: they are read here, shown as
 * a thumbnail or a chip above the box, and sent with the message. A pasted
 * screenshot never touched the disk, so the window is the only place that can
 * read it - which is why the picker and the paste handler both land here.
 */
export function ChatComposer({
  ref,
  config,
  busy,
  hasFolder,
  mentionItems,
  onSubmit,
  onSelectModel,
  onStop,
  onDropFiles,
}: ChatComposerProps) {
  const [empty, setEmpty] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [attachments, setAttachments] = useState<ChatAttachmentInput[]>([])
  const [attachError, setAttachError] = useState('')
  const [reading, setReading] = useState(false)
  const [changingModel, setChangingModel] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

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

  async function addFiles(files: File[]) {
    if (!files.length) return
    setAttachError('')
    setReading(true)
    try {
      const read = await readAttachments(files, attachments.length)
      setAttachments((current) => [...current, ...read])
    } catch (problem) {
      setAttachError(readable(problem))
    } finally {
      setReading(false)
    }
  }

  function remove(id: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id))
  }

  function send() {
    if (busy || changingModel || !config?.model) return
    const text = (editor?.getText({ blockSeparator: '\n' }) ?? '').trim()
    if (text.length > MAX_LENGTH) return
    if (!text && !attachments.length) return
    onSubmit(text, attachments)
  }

  useImperativeHandle(
    ref,
    () => ({
      // The draft stays in the composer unless the message actually went out, so
      // clearing takes the attachments with it.
      clear: () => {
        if (editor && !editor.isDestroyed) editor.commands.clearContent(true)
        setAttachments([])
        setAttachError('')
      },
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
      onPasteCapture={(event) => {
        // A copied screenshot arrives as a file, not as text. Reading it here
        // keeps it out of the editor, which would otherwise embed it as an image
        // node the model never sees. Pasted text has no files and passes through.
        const files = Array.from(event.clipboardData?.files ?? [])
        if (!files.length) return
        event.preventDefault()
        event.stopPropagation()
        void addFiles(files)
      }}
      onDropCapture={(event) => {
        const files = Array.from(event.dataTransfer.files)
        if (!files.length) return
        event.preventDefault()
        event.stopPropagation()
        setDragging(false)
        // A picture is attached and looked at; everything else keeps the folder
        // behaviour, where a dropped file lands in the conversation folder and is
        // mentioned so the file tools can read it.
        const images = files.filter((file) => file.type.startsWith('image/'))
        const rest = files.filter((file) => !file.type.startsWith('image/'))
        if (images.length) void addFiles(images)
        if (rest.length) onDropFiles(rest)
      }}
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
      onKeyDown={(event) => {
        // Enter sends, unless the @ popup is open or a line break is wanted.
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
        if (!editor || mentionBridge(editor).suggesting) return
        if (!(event.target instanceof Node) || !editor.view.dom.contains(event.target)) return
        event.preventDefault()
        send()
      }}
    >
      {dragging && <div className="chat-drop-target">Drop to add to this chat</div>}
      {attachments.length > 0 && (
        <ul className="chat-attachments" aria-label="Attachments">
          {attachments.map((attachment) => (
            <li className="chat-attachment" key={attachment.id}>
              {attachment.kind === 'image' && attachment.preview ? (
                <img
                  className="chat-attachment-image"
                  src={attachment.preview}
                  alt={attachment.name}
                />
              ) : (
                <span className="chat-attachment-file">
                  <FileIcon size={15} />
                  <span>{extensionOf(attachment.name)}</span>
                </span>
              )}
              <span className="chat-attachment-name" title={attachment.name}>
                {attachment.name}
              </span>
              <button
                type="button"
                className="chat-attachment-remove"
                onClick={() => remove(attachment.id)}
                aria-label={`Remove ${attachment.name}`}
                title="Remove"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {attachError && (
        <p className="chat-attachment-error" role="alert">
          {attachError}
        </p>
      )}
      <EditorContent editor={editor} />
      <div className="chat-composer-footer">
        <button
          type="button"
          className="chat-attach"
          disabled={busy || reading || attachments.length >= MAX_ATTACHMENTS}
          onClick={() => picker.current?.click()}
          aria-label="Attach files"
          title="Attach files or pictures"
        >
          <PaperclipIcon />
        </button>
        <input
          ref={picker}
          className="chat-attach-input"
          type="file"
          multiple
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            // Reset first: choosing the same file twice must still fire a change.
            event.target.value = ''
            void addFiles(files)
          }}
        />
        <span>
          <select
            className="chat-model-select"
            aria-label="Chat model"
            title={config?.provider ? `${config.provider} · ${config.baseURL}` : 'Choose a model'}
            disabled={busy || changingModel}
            value={config?.model ? JSON.stringify([config.provider, config.model]) : ''}
            onChange={async (event) => {
              const [provider, model] = JSON.parse(event.target.value) as [string, string]
              setChangingModel(true)
              try {
                await onSelectModel(provider, model)
              } finally {
                setChangingModel(false)
              }
            }}
          >
            <option value="" disabled>
              Choose a model
            </option>
            {config?.providers?.map((provider) => (
              <optgroup key={provider.id} label={provider.id}>
                {provider.models.map((model) => (
                  <option key={model} value={JSON.stringify([provider.id, model])}>
                    {model}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
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
          <button
            className="primary"
            type="submit"
            disabled={(empty && !attachments.length) || !config?.model || changingModel}
          >
            Send
          </button>
        )}
      </div>
    </form>
  )
}
