import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent } from 'react'
import type { Desktop } from '@sisyphus/sdk'
import type { ActionPresentations } from '@sisyphus/sdk'
import { errorMessage, findType, type Flow, type Run, type StepType } from './action-model'
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
  reportError,
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
  reportError: (error: string) => void
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
  const dirtyRef = useRef(false)
  const alive = useRef(true)
  const [previous, setPrevious] = useState(flow.inputs)
  if (previous !== flow.inputs) {
    setPrevious(flow.inputs)
    if (!dirty) setInputs(flow.inputs ?? [])
  }
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (timer.current) clearTimeout(timer.current)
      if (dirtyRef.current) {
        const inputValues = Object.fromEntries(
          current.current.map((input) => [input.key, input.value]),
        )
        void pending.current
          .catch(() => {})
          .then(() =>
            desktop.call('automations.inputs.set', {
              id: flow.id,
              inputValues,
              drafts: Object.fromEntries(
                current.current
                  .filter((input) => input.draft !== undefined)
                  .map((input) => [input.key, input.draft]),
              ),
            }),
          )
          .catch((problem) => reportError(`${flow.title}: ${errorMessage(problem)}`))
      }
    }
  }, [desktop, flow.id, flow.title, reportError])
  useEffect(() => {
    current.current = inputs
  }, [inputs])
  const values = (items = current.current) =>
    Object.fromEntries(items.map((item) => [item.key, item.value]))
  async function persist() {
    if (timer.current) clearTimeout(timer.current)
    const captured = current.current
    if (!dirtyRef.current) {
      await pending.current
      return
    }
    setSaving(true)
    const task = pending.current
      .catch(() => {})
      .then(async () => {
        await desktop.call('automations.inputs.set', {
          id: flow.id,
          inputValues: values(captured),
          drafts: Object.fromEntries(
            captured
              .filter((input) => input.draft !== undefined)
              .map((input) => [input.key, input.draft]),
          ),
        })
        if (current.current === captured) {
          dirtyRef.current = false
          if (alive.current) setDirty(false)
        }
      })
    pending.current = task
    try {
      await task
      if (alive.current) setError('')
    } finally {
      if (alive.current && pending.current === task) setSaving(false)
    }
  }
  async function launch() {
    setStarting(true)
    try {
      const inputValues = values()
      await persist()
      if (
        current.current.some((input) => input.draft !== undefined) ||
        root.current?.querySelector('[aria-invalid="true"]')
      )
        throw new Error('Draft saved. Finish the highlighted input before running.')
      await desktop.call('automations.start', { id: flow.id, inputValues })
      setError('')
    } catch (problem) {
      setError(errorMessage(problem))
    } finally {
      setStarting(false)
    }
  }
  const running = run?.status === 'running'
  const missing = flow.nodes.filter((node) => !findType(types, node.type))
  function changeInput(key: string, patch: Partial<(typeof inputs)[number]>) {
    const next = current.current.map((input) =>
      input.key === key ? { ...input, ...patch } : input,
    )
    current.current = next
    dirtyRef.current = true
    setDirty(true)
    setInputs(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void persist().catch((problem) => {
        if (alive.current) setError(errorMessage(problem))
      })
    }, 400)
  }
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
        {running ? (
          <button onClick={() => cancel(flow.id)}>Stop</button>
        ) : (
          <button
            className="primary action-card-run"
            aria-label={`Run ${flow.title}`}
            disabled={starting || missing.length > 0}
            onClick={() => void launch()}
          >
            {starting ? 'Starting…' : 'Run'}
          </button>
        )}
      </header>
      {flow.description && <p className="action-card-description">{flow.description}</p>}
      <div className="action-card-inputs">
        <CardInputValues
          compact
          inputs={inputs}
          desktop={desktop}
          presentations={presentations}
          change={(key, value) => changeInput(key, { value, draft: undefined })}
          changeDraft={(key, draft) => changeInput(key, { draft })}
        />
      </div>
      {missing.length > 0 && (
        <p className="action-card-warning">
          Unavailable: {missing.map((node) => node.title).join(', ')}
        </p>
      )}
      {error && (
        <div role="alert" className="action-card-notification">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}
      <div className="action-card-controls">
        <span role="status">
          {saving
            ? 'Saving…'
            : dirty
              ? 'Unsaved changes'
              : run
                ? run.status === 'succeeded'
                  ? 'Complete'
                  : run.status === 'cancelled'
                    ? 'Stopped'
                    : run.status === 'running'
                      ? 'Running…'
                      : 'Failed'
                : `${flow.nodes.length} ${flow.nodes.length === 1 ? 'step' : 'steps'}`}
        </span>
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
        <button
          aria-label={`Edit ${flow.title}`}
          disabled={running || starting}
          onClick={() => {
            edit({ ...flow, inputs: current.current })
          }}
        >
          Edit
        </button>
        <details className="action-card-menu">
          <summary aria-label={`Options for ${flow.title}`}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <circle cx="3" cy="8" r="1.5" />
              <circle cx="8" cy="8" r="1.5" />
              <circle cx="13" cy="8" r="1.5" />
            </svg>
          </summary>
          <div>
            <button
              disabled={running || saving}
              onClick={() => {
                void persist()
                  .then(() => duplicate({ ...flow, inputs: current.current }))
                  .catch((problem) => setError(errorMessage(problem)))
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
