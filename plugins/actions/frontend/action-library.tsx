import { useEffect, useRef, useState } from 'react'
import type { Field, StepType } from './action-model'

const valueText = (value: unknown) => (value === undefined ? 'Not set' : JSON.stringify(value))
const kindLabel = (kind: Field['kind']) =>
  ({
    json: 'JSON',
    lines: 'List of text',
    targets: 'List of paths or URLs',
    file: 'File path',
    folder: 'Folder path',
    select: 'Choice',
    boolean: 'On / off',
    text: 'Text',
    number: 'Number',
  })[kind]

export function ActionReference({ action }: { action: StepType }) {
  return (
    <article className="action-reference">
      <div className="action-reference-identity">
        {action.service?.name ?? 'Action'} <code>{action.type}</code>
      </div>
      <h2>{action.name}</h2>
      <p className="action-reference-purpose">{action.description || 'No description provided.'}</p>
      <section>
        <h3>Inputs</h3>
        {!action.fields.length && <p>No inputs.</p>}
        <dl>
          {action.fields.map((field) => (
            <div key={field.key}>
              <dt>
                {field.label}{' '}
                <span>
                  {kindLabel(field.kind)}
                  {field.required ? ' · Required' : ''}
                </span>
              </dt>
              <dd>
                <code>{field.key}</code>
                {field.hint && <p>{field.hint}</p>}
                {field.when && (
                  <p>
                    Used when <code>{field.when.key}</code> is <code>{field.when.value}</code>.
                  </p>
                )}
                {field.options && (
                  <p>Choices: {field.options.map((option) => option.label).join(', ')}.</p>
                )}
                {(field.min !== undefined || field.max !== undefined) && (
                  <p>
                    Range: {field.min ?? 'any'} to {field.max ?? 'any'}.
                  </p>
                )}
                <p className="action-reference-default">
                  Default: <code>{valueText(action.defaults[field.key])}</code>
                </p>
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section>
        <h3>Outputs</h3>
        <p>
          Use an output in a later step with <strong>Use another value</strong>. Its execution
          dependency is added automatically.
        </p>
        {!action.outputs?.length && <p>No documented outputs.</p>}
        <dl>
          {action.outputs?.map((field) => (
            <div key={field.key}>
              <dt>
                {field.label} <span>{kindLabel(field.kind)}</span>
              </dt>
              <dd>
                <code>{field.key}</code>
                {field.hint && <p>{field.hint}</p>}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section>
        <h3>State changes</h3>
        <ul>
          {(action.effects ?? ['The provider has not documented state changes.']).map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Calls &amp; behavior</h3>
        <ul>
          {[
            ...(action.calls ?? ['The provider handles this function call.']),
            ...(action.notes ?? []),
          ].map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </section>
      {!!action.examples?.length && (
        <section>
          <h3>Examples</h3>
          {action.examples.map((example) => (
            <div key={example.title}>
              <h4>{example.title}</h4>
              <span>Input</span>
              <pre>{JSON.stringify(example.input, null, 2)}</pre>
              {example.output !== undefined && (
                <>
                  <span>Output</span>
                  <pre>{JSON.stringify(example.output, null, 2)}</pre>
                </>
              )}
            </div>
          ))}
        </section>
      )}
    </article>
  )
}

export function ActionLibrary({
  types,
  add,
  close,
  after,
  canAdd = true,
}: {
  types: StepType[]
  add: (type: StepType) => void
  close: () => void
  after: string
  canAdd?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [service, setService] = useState('')
  const [selected, setSelected] = useState('')
  const services = [
    ...new Map(
      types.map((type) => [type.service?.id ?? 'other', type.service?.name ?? 'Other']),
    ).entries(),
  ]
  const matches = types.filter(
    (type) =>
      (!service || (type.service?.id ?? 'other') === service) &&
      `${type.name} ${type.description} ${type.service?.name} ${type.type} ${type.fields.map((field) => field.label).join(' ')}`
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
  )
  const current = matches.find((type) => type.type === selected) ?? matches[0]
  useEffect(() => {
    const element = dialog.current!
    const previous = document.activeElement as HTMLElement | null
    element.showModal()
    search.current?.focus()
    return () => {
      element.close()
      previous?.focus()
    }
  }, [])
  return (
    <dialog
      ref={dialog}
      className="action-library-dialog"
      aria-labelledby="action-library-title"
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
    >
      <div className="actions-panel action-library">
        <header>
          <div>
            <span className="action-kicker">BUILDING BLOCKS</span>
            <h2 id="action-library-title">Action library</h2>
            <p>Choose what happens next. Read the reference, then add it to your workflow.</p>
          </div>
          <button onClick={close} aria-label="Close action library">
            ×
          </button>
        </header>
        <div className="action-library-search">
          <input
            ref={search}
            type="search"
            aria-label="Find an action"
            placeholder="Search actions, services, or inputs…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span>{matches.length} actions</span>
        </div>
        <nav className="action-library-categories" aria-label="Services">
          <button aria-pressed={!service} onClick={() => setService('')}>
            All services
          </button>
          {services.map(([id, name]) => (
            <button key={id} aria-pressed={service === id} onClick={() => setService(id)}>
              {name}
            </button>
          ))}
        </nav>
        <div className="action-library-content">
          <div className="action-library-list" aria-label="Available actions">
            {matches.map((type) => (
              <button
                key={type.type}
                aria-pressed={current?.type === type.type}
                onClick={() => setSelected(type.type)}
              >
                <span className="action-library-icon" aria-hidden="true">
                  {type.icon ?? '↗'}
                </span>
                <span>
                  <small>{type.service?.name ?? 'Other'}</small>
                  <strong>{type.name}</strong>
                  <span>{type.description}</span>
                </span>
                <span aria-hidden="true">›</span>
              </button>
            ))}
            {!matches.length && (
              <div className="actions-empty">
                <h3>{types.length ? 'No matching actions' : 'No action providers available'}</h3>
                <p>
                  {types.length
                    ? 'Try another search or service.'
                    : 'Enable an action provider in Plugins to get started.'}
                </p>
                {types.length > 0 && (
                  <button
                    onClick={() => {
                      setQuery('')
                      setService('')
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="action-library-preview">
            {current ? (
              <ActionReference action={current} />
            ) : (
              <p>Select an action to read its reference.</p>
            )}
          </div>
        </div>
        <footer>
          <span>
            Add after <strong>{after}</strong>
          </span>
          <button onClick={close}>Cancel</button>
          <button
            className="primary"
            disabled={!current || !canAdd}
            onClick={() => current && add(current)}
          >
            {canAdd ? `Add ${current?.name ?? 'step'}` : '64-step limit reached'}
          </button>
        </footer>
      </div>
    </dialog>
  )
}
