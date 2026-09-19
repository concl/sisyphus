import { useEffect, useRef, useState } from 'react'

interface MessageEditorProps {
  /** The text the message was written with; the box opens on it. */
  text: string
  /** True while a reply is running: a new version has to wait for it. */
  busy: boolean
  onSave(text: string): void
  onCancel(): void
}

/**
 * Editing happens inside the message it belongs to. The turn opens into a box
 * where it sits, so the sentence being rewritten, its other versions, and the
 * original it replaces all stay on screen together - there is no separate bar to
 * read and no doubt about which message is being changed. Saving sends the new
 * attempt as a sibling version and keeps the original as it was.
 */
export function MessageEditor({ text, busy, onSave, onCancel }: MessageEditorProps) {
  const [draft, setDraft] = useState(text)
  const box = useRef<HTMLTextAreaElement | null>(null)

  // Opening an edit takes the keyboard, with the caret after the last word, so
  // the wording can be changed without reaching for the mouse first.
  useEffect(() => {
    const element = box.current
    if (!element) return
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
    grow(element)
  }, [])

  /** Room to see the whole message, never a scrollbar inside a short one. */
  function grow(element: HTMLTextAreaElement) {
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }

  function save() {
    const value = draft.trim()
    if (!value || busy) return
    onSave(value)
  }

  return (
    <div className="chat-edit">
      <textarea
        ref={box}
        className="chat-edit-input"
        aria-label="Edit your message"
        value={draft}
        rows={1}
        onChange={(event) => {
          setDraft(event.target.value)
          grow(event.target)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
            return
          }
          // Enter keeps writing: a message is usually a few lines, and saving one
          // should be deliberate.
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            save()
          }
        }}
      />
      <div className="chat-edit-actions">
        <span>
          The original stays in the conversation as the previous version. Esc cancels, and
          Ctrl+Enter saves it (⌘+Enter on a Mac).
        </span>
        <button type="button" onClick={onCancel} title="Leave the message as it was">
          Cancel
        </button>
        <button
          className="primary"
          type="button"
          disabled={busy || !draft.trim()}
          onClick={save}
          title={
            busy ? 'Wait for the current reply to finish' : 'Save as a new version and send it'
          }
        >
          Save and send
        </button>
      </div>
    </div>
  )
}
