import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Desktop } from '@sisyphus/sdk'
import type { ActionPresentations } from '@sisyphus/sdk'
import { inputField, type CardInput } from './action-model'
import { ConfigField } from './action-fields'

function InputDialog({
  input,
  desktop,
  presentations,
  done,
  close,
}: {
  input: CardInput
  desktop: Desktop
  presentations?: ActionPresentations
  done: (value: unknown) => void
  close: () => void
}) {
  const [value, setValue] = useState(input.value)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current!
    const previous = document.activeElement as HTMLElement | null
    element.showModal()
    element.querySelector<HTMLElement>('input, textarea, select')?.focus()
    return () => {
      element.close()
      previous?.focus()
    }
  }, [])
  return createPortal(
    <dialog
      ref={dialog}
      className="action-input-dialog"
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onClick={(event) => {
        if (event.target === dialog.current) close()
      }}
      aria-labelledby="action-input-dialog-title"
    >
      <form
        className="actions-panel action-input-dialog-content"
        onSubmit={(event) => {
          event.preventDefault()
          if (dialog.current?.querySelector('[aria-invalid="true"]')) {
            setError('Check the highlighted fields.')
            return
          }
          done(value)
        }}
      >
        <header>
          <h2 id="action-input-dialog-title">{input.label}</h2>
          <button type="button" aria-label="Close input" onClick={close}>
            Close
          </button>
        </header>
        <ConfigField
          field={inputField(input)}
          config={{ value }}
          draftText={input.draft}
          change={(_, value) => setValue(value)}
          desktop={desktop}
          presentations={presentations}
        />
        <p className="action-error action-field-feedback" role="status">
          {error}
        </p>
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary">Done</button>
        </footer>
      </form>
    </dialog>,
    document.body,
  )
}
export function CardValuePopup({
  input,
  desktop,
  presentations,
  change,
}: {
  input: CardInput
  desktop: Desktop
  presentations?: ActionPresentations
  change: (value: unknown) => void
}) {
  const [open, setOpen] = useState(false)
  const Summary = presentations?.get(input.editor)?.summary
  return (
    <div className="action-card-complex-input">
      <span>{input.label}</span>
      <button
        className="action-input-summary"
        aria-label={`Edit ${input.label} input`}
        onClick={() => setOpen(true)}
      >
        {input.draft !== undefined ? (
          <span className="action-error">Unfinished JSON · edit to continue</span>
        ) : Summary ? (
          <Summary value={input.value} />
        ) : (
          <span>
            {input.value && typeof input.value === 'object'
              ? `${Object.keys(input.value).length} ${Array.isArray(input.value) ? 'items' : 'fields'}`
              : String(input.value ?? 'Set value')}
          </span>
        )}
        <span className="action-input-edit-label">Edit</span>
      </button>
      {open && (
        <InputDialog
          input={input}
          desktop={desktop}
          presentations={presentations}
          close={() => setOpen(false)}
          done={(value) => {
            change(value)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}
