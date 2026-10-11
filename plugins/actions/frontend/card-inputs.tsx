import type { Desktop } from '@sisyphus/sdk'
import { inputField, type CardInput } from './action-model'
import { CardValuePopup } from './card-value-popup'
import { ConfigField } from './action-fields'
import type { ActionPresentations } from '@sisyphus/sdk'

const kinds: { value: CardInput['kind']; label: string }[] = [
  { value: 'lines', label: 'List' },
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'On / off' },
  { value: 'json', label: 'Structured data (JSON)' },
  { value: 'urls', label: 'Web addresses (legacy)' },
]
export function CardInputValues({
  inputs,
  desktop,
  change,
  presentations,
  compact = false,
  changeDraft,
}: {
  inputs: CardInput[]
  desktop: Desktop
  change: (key: string, value: CardInput['value']) => void
  presentations?: ActionPresentations
  compact?: boolean
  changeDraft?: (key: string, draft: string | undefined) => void
}) {
  return (
    <>
      {inputs.map((input) =>
        compact && input.kind === 'json' ? (
          <CardValuePopup
            key={input.key}
            input={input}
            desktop={desktop}
            presentations={presentations}
            change={(value) => change(input.key, value)}
          />
        ) : (
          <ConfigField
            key={input.key}
            desktop={desktop}
            presentations={presentations}
            field={inputField(input)}
            compact={compact}
            draftText={input.draft}
            changeDraft={changeDraft ? (text) => changeDraft(input.key, text) : undefined}
            config={{ value: input.value }}
            change={(_, value) => change(input.key, value as CardInput['value'])}
          />
        ),
      )}
    </>
  )
}
export function CardInputsEditor({
  inputs,
  desktop,
  change,
  remove,
  presentations,
}: {
  inputs: CardInput[]
  desktop: Desktop
  change: (inputs: CardInput[]) => void
  remove: (key: string) => void
  presentations?: ActionPresentations
}) {
  const update = (key: string, patch: Partial<CardInput>) =>
    change(inputs.map((input) => (input.key === key ? { ...input, ...patch } : input)))
  return (
    <section className="action-input-definitions">
      <div>
        <h3>Card inputs</h3>
        <button
          type="button"
          onClick={() =>
            change([
              ...inputs,
              { key: crypto.randomUUID(), label: 'New input', kind: 'text', value: '' },
            ])
          }
        >
          + Add input
        </button>
      </div>
      <p>
        Expose the settings you want to change from the card. Select a step to connect its settings
        to an input.
      </p>
      {inputs.map((input) => (
        <div className="action-input-definition" key={input.key}>
          <label className="action-field">
            <span>Input label</span>
            <input
              aria-label={`Label for ${input.label}`}
              value={input.label}
              maxLength={80}
              onChange={(event) => update(input.key, { label: event.target.value })}
            />
          </label>
          <label className="action-field">
            <span>Type</span>
            <select
              value={input.kind}
              onChange={(event) => {
                const kind = event.target.value as CardInput['kind']
                update(input.key, {
                  kind,
                  field: undefined,
                  editor: undefined,
                  draft: undefined,
                  value:
                    kind === 'urls' || kind === 'lines'
                      ? []
                      : kind === 'number'
                        ? 0
                        : kind === 'boolean'
                          ? false
                          : kind === 'json'
                            ? {}
                            : '',
                })
              }}
            >
              {kinds.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {kind.label}
                </option>
              ))}
            </select>
          </label>
          <ConfigField
            key={`${input.key}:${input.kind}`}
            field={inputField(input, 'Saved default')}
            config={{ value: input.value }}
            desktop={desktop}
            presentations={presentations}
            draftText={input.draft}
            changeDraft={(draft) => update(input.key, { draft })}
            change={(_, value) =>
              update(input.key, { value: value as CardInput['value'], draft: undefined })
            }
          />
          <button className="action-remove" onClick={() => remove(input.key)}>
            Remove input
          </button>
        </div>
      ))}
    </section>
  )
}
