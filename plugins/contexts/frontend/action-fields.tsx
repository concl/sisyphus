import { useState, useSyncExternalStore } from 'react'
import type { ActionPresentations } from '../../actions/frontend/presentations'
const noSubscribe = () => () => {}
const noSnapshot = () => 0
import type { Desktop } from '@sisyphus/sdk'
import {
  compatibleInput,
  bindingId,
  inputKey,
  stepKey,
  type CardInput,
  type Field,
  type Binding,
  type SourceOption,
} from './action-model'

export function ConfigField({
  field,
  config,
  change,
  desktop,
  inputs = [],
  binding,
  bind,
  sources = [],
  presentations,
  changeInput,
  expose,
  compact = false,
}: {
  field: Field
  config: Record<string, unknown>
  change: (key: string, value: unknown) => void
  desktop: Desktop
  inputs?: CardInput[]
  binding?: Binding
  bind?: (key: Binding | null) => void
  sources?: SourceOption[]
  presentations?: ActionPresentations
  changeInput?: (key: string, value: unknown) => void
  expose?: (show: boolean) => void
  compact?: boolean
}) {
  useSyncExternalStore(
    presentations?.subscribe ?? noSubscribe,
    presentations?.getSnapshot ?? noSnapshot,
  )
  const Input = presentations?.get(field.editor)?.input
  const wholeInput =
    binding && inputKey(binding) && !(typeof binding === 'object' && binding.path?.length)
  const inlineInput = Boolean(wholeInput && changeInput)
  const linked = Boolean(binding && !inlineInput)
  const Label = Input && !linked ? 'div' : 'label'
  const [problem, setProblem] = useState('')
  const [lines, setLines] = useState(() =>
    Array.isArray(config[field.key]) ? (config[field.key] as string[]).join('\n') : '',
  )
  const [json, setJson] = useState(() => JSON.stringify(config[field.key] ?? null, null, 2))
  const [number, setNumber] = useState(() => String(config[field.key] ?? ''))
  const [propertyPath, setPropertyPath] = useState(() =>
    typeof binding === 'object'
      ? (binding.path?.slice('step' in binding ? 1 : 0).join('.') ?? '')
      : '',
  )
  const value = config[field.key]
  const encoded = JSON.stringify(value ?? null)
  const [previousValue, setPreviousValue] = useState(encoded)
  if (previousValue !== encoded) {
    setPreviousValue(encoded)
    setLines(Array.isArray(value) ? value.join('\n') : '')
    setJson(JSON.stringify(value ?? null, null, 2))
    setNumber(String(value ?? ''))
    setProblem('')
  }
  const available: SourceOption[] = [
    ...inputs
      .filter((input) => compatibleInput(field.kind, input.kind))
      .map((input) => ({
        reference: input.kind === 'json' ? { input: input.key, path: [] } : input.key,
        label: `Workflow input: ${input.label}`,
      })),
    ...sources,
  ]
  const source = binding
    ? available.find(
        (item) =>
          bindingId(item.reference) === bindingId(binding) ||
          (wholeInput && inputKey(item.reference) === inputKey(binding)),
      )
    : undefined
  if (field.when && config[field.when.key] !== field.when.value) return null
  const update = (value: unknown) => {
    if (inlineInput && binding) changeInput?.(inputKey(binding)!, value)
    else change(field.key, value)
  }
  async function choose(kind: string) {
    try {
      setProblem('')
      const result = await desktop.call<{ path: string | null }>('automations.choose', { kind })
      if (!result.path) return
      if (field.kind === 'targets') {
        const next = [...((value as string[] | undefined) ?? []), result.path]
        setLines(next.join('\n'))
        setPreviousValue(JSON.stringify(next))
        update(next)
      } else update(result.path)
    } catch (error) {
      setProblem(String(error))
    }
  }
  return (
    <div className="action-field">
      <Label>
        <span>{field.label}</span>
        {linked && binding ? (
          <div className="action-bound-value">
            <span>
              Uses{' '}
              {typeof binding === 'string'
                ? inputs.find((input) => input.key === inputKey(binding))?.label
                : (source?.label ?? 'an unavailable source')}
            </span>
            <small>
              {stepKey(binding)
                ? 'Resolved when the earlier step finishes.'
                : Array.isArray(value)
                  ? value.join('\n')
                  : typeof value === 'object'
                    ? JSON.stringify(value, null, 2)
                    : String(value ?? '')}
            </small>
          </div>
        ) : Input ? (
          <Input value={value} change={update} />
        ) : field.kind === 'json' ? (
          <textarea
            rows={5}
            aria-label={field.label}
            value={json}
            aria-invalid={Boolean(problem)}
            onChange={(event) => {
              setJson(event.target.value)
              try {
                const parsed: unknown = JSON.parse(event.target.value)
                setPreviousValue(JSON.stringify(parsed))
                setProblem('')
                update(parsed)
              } catch {
                setProblem('Enter valid JSON before saving or running.')
              }
            }}
          />
        ) : field.kind === 'select' ? (
          <select
            value={String(value ?? '')}
            aria-label={field.label}
            onChange={(event) => update(event.target.value)}
          >
            {field.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : field.kind === 'boolean' ? (
          <input
            type="checkbox"
            checked={Boolean(value)}
            aria-label={field.label}
            onChange={(event) => update(event.target.checked)}
          />
        ) : field.kind === 'targets' || field.kind === 'lines' ? (
          <textarea
            rows={compact ? 2 : 3}
            aria-label={field.label}
            value={lines}
            onChange={(event) => {
              setLines(event.target.value)
              const next = event.target.value
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean)
              setPreviousValue(JSON.stringify(next))
              update(next)
            }}
          />
        ) : (
          <input
            type={field.kind === 'number' ? 'number' : 'text'}
            aria-label={field.label}
            value={field.kind === 'number' ? number : String(value ?? '')}
            min={field.min}
            max={field.max}
            required={field.kind === 'number'}
            aria-invalid={Boolean(problem)}
            onChange={(event) => {
              if (field.kind !== 'number') {
                update(event.target.value)
                return
              }
              setNumber(event.target.value)
              if (!event.target.validity.valid || !Number.isFinite(Number(event.target.value))) {
                setProblem(event.target.validationMessage || 'Enter a valid number.')
                return
              }
              const next = Number(event.target.value)
              setPreviousValue(JSON.stringify(next))
              setProblem('')
              update(next)
            }}
          />
        )}
      </Label>
      {expose && !linked && (
        <label className="action-expose">
          <input
            type="checkbox"
            aria-label={`Show ${field.label} on card`}
            checked={inlineInput}
            onChange={(event) => expose(event.target.checked)}
          />
          Show on card
        </label>
      )}
      {bind && (available.length > 0 || binding) && (
        <details className="action-field-source" open={linked}>
          <summary>{linked ? 'Change source' : 'Use another value'}</summary>
          <label>
            <span>Value from</span>
            <select
              aria-label={`Source for ${field.label}`}
              value={source ? bindingId(source.reference) : bindingId(binding)}
              onChange={(event) =>
                bind(
                  available.find((item) => bindingId(item.reference) === event.target.value)
                    ?.reference ?? null,
                )
              }
            >
              <option value="">This step</option>
              {binding && !source && <option value={bindingId(binding)}>Unavailable source</option>}
              {available.map((item) => (
                <option key={bindingId(item.reference)} value={bindingId(item.reference)}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {binding && typeof binding === 'object' && bind && !inlineInput && (
            <label className="action-result-path">
              <span>Property inside this value (optional)</span>
              <input
                aria-label={`Property path for ${field.label}`}
                placeholder="e.g. items.0.url"
                value={propertyPath}
                onChange={(event) => {
                  setPropertyPath(event.target.value)
                  bind({
                    ...binding,
                    path: [
                      ...('step' in binding ? (binding.path?.slice(0, 1) ?? []) : []),
                      ...event.target.value.split('.').filter(Boolean),
                    ],
                  })
                }}
              />
            </label>
          )}
        </details>
      )}
      {field.hint && !compact && <small>{field.hint}</small>}
      {!linked && ['file', 'folder', 'targets'].includes(field.kind) && (
        <div className="action-browse">
          <button
            type="button"
            onClick={() => void choose(field.kind === 'folder' ? 'folder' : 'file')}
          >
            {field.kind === 'targets' ? '+ File' : 'Browse…'}
          </button>
          {field.kind === 'targets' && (
            <button type="button" onClick={() => void choose('folder')}>
              + Folder
            </button>
          )}
        </div>
      )}
      {problem && (
        <small role="alert" className="action-error">
          {problem}
        </small>
      )}
    </div>
  )
}
