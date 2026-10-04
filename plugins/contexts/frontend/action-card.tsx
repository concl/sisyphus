import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent } from 'react'
import type { Desktop } from '@sisyphus/sdk'
import type { ActionPresentations } from '../../actions/frontend/presentations'
import { findType, type Flow, type Run, type StepType } from './action-model'
import { CardInputValues } from './card-inputs'

export function ActionCard({
  flow,
  run,
  types,
  desktop,
  presentations,
  edit,
  duplicate,
  remove,
  cancel,
  dragStart,
  dragEnd,
  drop,
}: {
  flow: Flow
  run?: Run
  types: StepType[]
  desktop: Desktop
  presentations: ActionPresentations
  edit: (flow: Flow) => void
  duplicate: (flow: Flow) => void
  remove: (flow: Flow) => void
  cancel: (id: string) => void
  dragStart: (event: DragEvent<HTMLButtonElement>) => void
  dragEnd: () => void
  drop: () => void
}) {
  useSyncExternalStore(presentations.subscribe, presentations.getSnapshot)
  const [inputs, setInputs] = useState(flow.inputs ?? [])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const root = useRef<HTMLElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef(Promise.resolve())
  const current = useRef(inputs)
  const [dirty, setDirty] = useState(false)
  const [previous, setPrevious] = useState(flow.inputs)
  if (previous !== flow.inputs) {
    setPrevious(flow.inputs)
    if (!dirty) setInputs(flow.inputs ?? [])
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  useEffect(() => {
    current.current = inputs
  }, [inputs])
  const values = (items = current.current) =>
    Object.fromEntries(items.map((item) => [item.key, item.value]))
  async function persist() {
    if (timer.current) clearTimeout(timer.current)
    if (root.current?.querySelector('[aria-invalid="true"]'))
      throw new Error('Check the highlighted input.')
    const captured = current.current
    setSaving(true)
    const task = pending.current
      .catch(() => {})
      .then(async () => {
        await desktop.call('automations.inputs.set', { id: flow.id, inputValues: values(captured) })
        if (current.current === captured) setDirty(false)
      })
    pending.current = task
    try {
      await task
      setError('')
    } finally {
      setSaving(false)
    }
  }
  async function launch() {
    setStarting(true)
    try {
      const inputValues = values()
      await persist()
      await desktop.call('automations.start', { id: flow.id, inputValues })
      setError('')
    } catch (problem) {
      setError(String(problem))
    } finally {
      setStarting(false)
    }
  }
  const running = run?.status === 'running'
  const missing = flow.nodes.filter((node) => !findType(types, node.type))
  return (
    <article
      ref={root}
      className={`action-card tone-${flow.color}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        drop()
      }}
    >
      <header className="action-card-header">
        <h2>{flow.title}</h2>
        <button
          className="action-drag-handle"
          draggable
          aria-label={`Move ${flow.title}`}
          title="Drag to reorder"
          onDragStart={dragStart}
          onDragEnd={dragEnd}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
            {[4, 8, 12].flatMap((y) =>
              [5, 11].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1" />),
            )}
          </svg>
        </button>
      </header>
      <p className="action-card-description">
        {flow.description ||
          [
            ...new Set(flow.nodes.map((node) => findType(types, node.type)?.name ?? node.title)),
          ].join(' · ')}
      </p>
      <div className="action-card-inputs">
        <CardInputValues
          inputs={inputs}
          desktop={desktop}
          presentations={presentations}
          change={(key, value) => {
            const next = inputs.map((input) => (input.key === key ? { ...input, value } : input))
            current.current = next
            setDirty(true)
            setInputs(next)
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => {
              void persist().catch((problem) => setError(String(problem)))
            }, 400)
          }}
        />
      </div>
      {missing.length > 0 && (
        <p className="action-card-warning">
          Unavailable: {missing.map((node) => node.title).join(', ')}
        </p>
      )}
      {error && (
        <p role="alert" className="action-error">
          {error}
        </p>
      )}
      <div className="action-card-controls">
        {running ? (
          <button onClick={() => cancel(flow.id)}>Stop</button>
        ) : (
          <button
            className="primary"
            aria-label={`Run ${flow.title}`}
            disabled={starting || missing.length > 0}
            onClick={() => void launch()}
          >
            {starting ? 'Starting…' : 'Run'}
          </button>
        )}
        <span role="status">{saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved settings'}</span>
        <button
          aria-label={`Edit ${flow.title}`}
          disabled={running || saving || starting}
          onClick={() => {
            void persist()
              .then(() => edit({ ...flow, inputs: current.current }))
              .catch((problem) => setError(String(problem)))
          }}
        >
          Edit
        </button>
        <details className="action-card-menu">
          <summary aria-label={`Options for ${flow.title}`}>Options</summary>
          <div>
            <button
              disabled={running || saving}
              onClick={() => {
                void persist()
                  .then(() => duplicate({ ...flow, inputs: current.current }))
                  .catch((problem) => setError(String(problem)))
              }}
            >
              Duplicate
            </button>
            <button disabled={running || saving} onClick={() => remove(flow)}>
              Delete
            </button>
          </div>
        </details>
      </div>
      {run && (
        <div className="action-card-results">
          <span className="action-card-status" role="status">
            {run.status === 'succeeded'
              ? 'Complete'
              : run.status === 'cancelled'
                ? 'Stopped'
                : run.status === 'running'
                  ? 'Running…'
                  : 'Failed'}
          </span>
          {flow.nodes.map((node) => {
            const state = run.nodes[node.id]
            if (!state) return null
            const Result = presentations.get(findType(types, node.type)?.presentation)?.result
            return (
              <div key={node.id}>
                {state.error && <p className="action-error">{state.error}</p>}
                {state.status === 'succeeded' && Result && <Result value={state.result} />}
                {(state.output || state.result !== undefined) && (
                  <details>
                    <summary>{node.title}: details</summary>
                    {state.output && <pre>{state.output}</pre>}
                    {state.result !== undefined && (
                      <pre>{JSON.stringify(state.result, null, 2)}</pre>
                    )}
                  </details>
                )}
              </div>
            )
          })}
        </div>
      )}
    </article>
  )
}
