import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { Desktop } from '@sisyphus/sdk'
import {
  colors,
  connectionError,
  HEIGHT,
  nodeSummary,
  resolvedConfig,
  findType,
  bindingId,
  inputKey,
  stepKey,
  compatibleInput,
  cardInputFor,
  start,
  WIDTH,
  type Edge,
  type Flow,
  type Run,
  type Step,
  type StepType,
} from './action-model'
import { ConfigField } from './action-fields'
import { CardInputsEditor } from './card-inputs'
import { ActionCard } from './action-card'
import type { ActionPresentations } from '../../actions/frontend/presentations'
import './actions.css'

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const blank = (): Flow => ({
  id: crypto.randomUUID(),
  title: '',
  description: '',
  color: 'blue',
  inputs: [],
  nodes: [],
  edges: [],
})
const statusLabel = (status?: string) =>
  status === 'succeeded'
    ? 'Complete'
    : status === 'running'
      ? 'Running'
      : status === 'failed'
        ? 'Failed'
        : status === 'cancelled'
          ? 'Stopped'
          : status === 'skipped'
            ? 'Skipped'
            : status === 'pending'
              ? 'Waiting'
              : 'Ready'

export function Actions({
  desktop,
  presentations,
}: {
  desktop: Desktop
  presentations: ActionPresentations
}) {
  const [flows, setFlows] = useState<Flow[]>([])
  const [types, setTypes] = useState<StepType[]>([])
  const [runs, setRuns] = useState<Record<string, Run>>({})
  const [draft, setDraft] = useState<Flow | null>(null)
  const [selected, setSelected] = useState<string>('start')
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [pointer, setPointer] = useState({ x: 0, y: 0 })
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [inspecting, setInspecting] = useState(true)
  const [stepQuery, setStepQuery] = useState('')
  const [dragging, setDragging] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const canvas = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  function validEditors() {
    if (!panel.current?.querySelector('[aria-invalid="true"]')) return true
    setError('Fix the invalid data before saving or running.')
    return false
  }
  const drag = useRef<{
    id: string
    x: number
    y: number
    clientX: number
    clientY: number
  } | null>(null)
  const original = useRef('')

  useEffect(() => {
    if (!adding) return
    panel.current?.querySelector<HTMLInputElement>('[aria-label="Find an action"]')?.focus()
    const outside = (event: globalThis.PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.action-add-wrap'))
        setAdding(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [adding])

  useEffect(() => {
    let alive = true
    let changed = false
    let progressed = false
    let typesChanged = false
    const offTypes = desktop.on<StepType[]>('actions.changed', (value) => {
      typesChanged = true
      if (alive) setTypes(value)
    })
    const offFlows = desktop.on<Flow[]>('automations.changed', (value) => {
      changed = true
      if (alive) setFlows(value)
    })
    const offRun = desktop.on<Run>('automations.run', (value) => {
      progressed = true
      if (alive) setRuns((current) => ({ ...current, [value.id]: value }))
    })
    void Promise.all([
      desktop.call<Flow[]>('automations.list'),
      desktop.call<StepType[]>('actions.list'),
      desktop.call<Run[]>('automations.runs'),
    ])
      .then(([saved, available, latest]) => {
        if (!alive) return
        if (!changed) setFlows(saved)
        if (!typesChanged) setTypes(available)
        if (!progressed) setRuns(Object.fromEntries(latest.map((run) => [run.id, run])))
      })
      .catch((problem) => {
        if (alive) setError(String(problem))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
      offFlows()
      offRun()
      offTypes()
    }
  }, [desktop])

  function edit(flow: Flow) {
    original.current = JSON.stringify(flow)
    setDraft(clone(flow))
    setSelected(flow.nodes[0]?.id ?? 'start')
    setSelectedEdge(null)
    setConnecting(null)
    setError('')
    setMessage('')
    setAdding(false)
    setInspecting(flow.nodes.length > 0)
    setZoom(1)
  }
  function close() {
    if (
      draft &&
      JSON.stringify(draft) !== original.current &&
      !window.confirm('Discard unsaved changes?')
    )
      return
    setDraft(null)
    setConnecting(null)
    setError('')
  }
  function updateNode(id: string, patch: Partial<Step>) {
    setDraft(
      (current) =>
        current && {
          ...current,
          nodes: current.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
        },
    )
  }
  function addNode(type: StepType) {
    if (!draft) return
    const last = draft.nodes.find((node) => node.id === selected) ?? draft.nodes.at(-1)
    const id = crypto.randomUUID()
    const inputs = type.fields
      .filter((field) => field.expose)
      .map((field) => cardInputFor(field, clone(type.defaults[field.key] ?? '')))
    const exposed = type.fields.filter((field) => field.expose)
    const node = {
      bindings: Object.fromEntries(exposed.map((field, index) => [field.key, inputs[index].key])),
      id,
      type: type.type,
      title: type.name,
      config: clone(type.defaults),
      x: last ? Math.min(last.x + 290, 7600) : 320,
      y: last ? last.y : 60,
    }
    setDraft({
      ...draft,
      inputs: [...(draft.inputs ?? []), ...inputs],
      nodes: [...draft.nodes, node],
      edges: [...draft.edges, { from: last?.id ?? 'start', to: id }],
    })
    setSelected(id)
    setInspecting(true)
    setSelectedEdge(null)
    setAdding(false)
    requestAnimationFrame(() =>
      canvas.current?.scrollTo({
        left: Math.max(0, node.x * zoom - 300),
        top: Math.max(0, node.y * zoom - 150),
        behavior: 'smooth',
      }),
    )
  }
  function exposeField(field: import('./action-model').Field, show: boolean) {
    if (!draft || !currentNode) return
    const bindings = { ...currentNode.bindings }
    if (show) {
      const input = cardInputFor(field, clone(currentConfig[field.key] ?? ''))
      bindings[field.key] = input.key
      setDraft({
        ...draft,
        inputs: [...(draft.inputs ?? []), input],
        nodes: draft.nodes.map((node) =>
          node.id === currentNode.id ? { ...node, bindings } : node,
        ),
      })
    } else {
      const reference = bindings[field.key]
      const key = reference ? inputKey(reference) : undefined
      delete bindings[field.key]
      const nodes = draft.nodes.map((node) =>
        node.id === currentNode.id
          ? {
              ...node,
              bindings,
              config: { ...node.config, [field.key]: clone(currentConfig[field.key] ?? '') },
            }
          : node,
      )
      const stillUsed = nodes.some((node) =>
        Object.values(node.bindings ?? {}).some((ref) => inputKey(ref) === key),
      )
      setDraft({
        ...draft,
        nodes,
        inputs: stillUsed ? draft.inputs : draft.inputs?.filter((input) => input.key !== key),
      })
    }
  }
  function connect(to: string) {
    if (!draft || !connecting) return
    const problem = connectionError(draft.edges, connecting, to)
    if (problem) {
      setError(problem)
      return
    }
    setDraft({ ...draft, edges: [...draft.edges, { from: connecting, to }] })
    setConnecting(null)
    setError('')
  }
  async function save(run = false) {
    if (!draft || busy) return
    if (!validEditors()) return
    setBusy(true)
    setError('')
    try {
      const saved = await desktop.call<Flow>('automations.save', draft)
      original.current = JSON.stringify(saved)
      setDraft(saved)
      setMessage('Saved.')
      if (run) await desktop.call('automations.start', { id: saved.id })
    } catch (problem) {
      setError(String(problem))
    } finally {
      setBusy(false)
    }
  }
  function removeInput(key: string) {
    if (!draft) return
    const input = draft.inputs?.find((input) => input.key === key)
    setDraft({
      ...draft,
      inputs: (draft.inputs ?? []).filter((input) => input.key !== key),
      nodes: draft.nodes.map((node) => ({
        ...node,
        config: {
          ...node.config,
          ...Object.fromEntries(
            Object.entries(node.bindings ?? {})
              .filter(([, value]) => inputKey(value) === key)
              .map(([field]) => [field, clone(input?.value ?? '')]),
          ),
        },
        bindings: Object.fromEntries(
          Object.entries(node.bindings ?? {}).filter(([, value]) => inputKey(value) !== key),
        ),
      })),
    })
  }
  async function cancel(id: string) {
    try {
      await desktop.call('automations.cancel', { id })
    } catch (problem) {
      setError(String(problem))
    }
  }
  async function remove(flow: Flow) {
    if (!window.confirm(`Delete “${flow.title}”?`)) return
    try {
      await desktop.call('automations.delete', { id: flow.id })
      if (draft?.id === flow.id) setDraft(null)
    } catch (problem) {
      setError(String(problem))
    }
  }
  async function duplicate(flow: Flow) {
    const next = {
      ...clone(flow),
      id: crypto.randomUUID(),
      title: `${flow.title.slice(0, 72)} copy`,
    }
    try {
      const saved = await desktop.call<Flow>('automations.save', next)
      edit(saved)
    } catch (problem) {
      setError(String(problem))
    }
  }
  async function dropCard(id: string) {
    if (!dragging || dragging === id) return
    const ids = flows.map((flow) => flow.id).filter((item) => item !== dragging)
    ids.splice(ids.indexOf(id), 0, dragging)
    setDragging(null)
    try {
      await desktop.call('automations.reorder', { ids })
    } catch (problem) {
      setError(String(problem))
    }
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (drag.current) {
      const current = drag.current
      updateNode(current.id, {
        x: Math.max(0, Math.min(8000, current.x + (event.clientX - current.clientX) / zoom)),
        y: Math.max(0, Math.min(8000, current.y + (event.clientY - current.clientY) / zoom)),
      })
    }
    if (connecting && canvas.current) {
      const bounds = canvas.current.getBoundingClientRect()
      setPointer({
        x: (event.clientX - bounds.left + canvas.current.scrollLeft) / zoom,
        y: (event.clientY - bounds.top + canvas.current.scrollTop) / zoom,
      })
    }
  }
  const activeRun = draft ? runs[draft.id] : undefined
  const currentNode = draft?.nodes.find((node) => node.id === selected)
  const currentType = findType(types, currentNode?.type)
  const currentConfig = currentNode ? resolvedConfig(currentNode, draft?.inputs ?? []) : {}
  const currentState = currentNode && activeRun?.nodes[currentNode.id]
  const width = Math.max(1100, ...(draft?.nodes.map((node) => node.x + WIDTH + 150) ?? []))
  const height = Math.max(650, ...(draft?.nodes.map((node) => node.y + HEIGHT + 150) ?? []))
  function fit() {
    if (!canvas.current || !draft) return
    const contentWidth = Math.max(280, ...draft.nodes.map((node) => node.x + WIDTH + 30))
    const contentHeight = Math.max(210, ...draft.nodes.map((node) => node.y + HEIGHT + 30))
    setZoom(
      Math.max(
        0.25,
        Math.min(
          1,
          canvas.current.clientWidth / contentWidth,
          canvas.current.clientHeight / contentHeight,
        ),
      ),
    )
    canvas.current.scrollTo({ left: 0, top: 0 })
  }
  const point = (id: string, output: boolean) => {
    const node = id === 'start' ? start : (draft?.nodes.find((item) => item.id === id) ?? start)
    return { x: node.x + (output ? WIDTH : 0), y: node.y + HEIGHT / 2 }
  }
  const curve = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const distance = Math.max(60, Math.abs(to.x - from.x) / 2)
    return `M ${from.x} ${from.y} C ${from.x + distance} ${from.y}, ${to.x - distance} ${to.y}, ${to.x} ${to.y}`
  }
  function port(id: string, output: boolean, title: string) {
    return (
      <button
        type="button"
        className={`action-port ${output ? 'output' : 'input'} ${connecting === id && output ? 'connecting' : ''}`}
        data-input={output ? undefined : id}
        aria-label={`${output ? 'Connect from' : 'Connect to'} ${title}`}
        title={output ? 'Drag or click, then choose an input' : 'Connect an output here'}
        onPointerDown={(event) => {
          event.stopPropagation()
          if (output) {
            setConnecting(id)
            setPointer(point(id, true))
            setError('')
          }
        }}
        onClick={(event) => {
          event.stopPropagation()
          if (output) {
            setConnecting(id)
            setPointer(point(id, true))
            setError('')
          } else connect(id)
        }}
      />
    )
  }

  return (
    <div
      ref={panel}
      className={`actions-panel ${draft ? 'editing' : ''}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setConnecting(null)
          setAdding(false)
        }
      }}
    >
      <header className="actions-heading">
        <div>
          <h1>{draft ? 'Edit action' : 'Actions'}</h1>
        </div>
        <div className="actions-heading-buttons">
          {draft ? (
            <>
              <button onClick={close} disabled={busy}>
                Back to cards
              </button>
              <button onClick={() => void save()} disabled={busy}>
                Save
              </button>
              {activeRun?.status === 'running' ? (
                <button onClick={() => void cancel(draft.id)}>Stop</button>
              ) : (
                <button className="primary" onClick={() => void save(true)} disabled={busy}>
                  Save &amp; run
                </button>
              )}
            </>
          ) : (
            <button className="primary" disabled={loading} onClick={() => edit(blank())}>
              + New action
            </button>
          )}
        </div>
      </header>
      {error && (
        <p className="action-feedback action-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="action-feedback" role="status">
          {message}
        </p>
      )}
      {draft ? (
        <>
          <div className="action-metadata">
            <label className="action-title-field">
              <span>Card title</span>
              <input
                aria-label="Card title"
                value={draft.title}
                maxLength={80}
                placeholder="Action title"
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </label>
            <div className="action-colors" role="group" aria-label="Card color">
              {colors.map((color) => (
                <button
                  key={color}
                  className={`action-swatch tone-${color}`}
                  aria-label={`${color} card`}
                  aria-pressed={draft.color === color}
                  onClick={() => setDraft({ ...draft, color })}
                />
              ))}
            </div>
          </div>
          {draft.programId &&
            flows.some((flow) => flow.id !== draft.id && flow.programId === draft.programId) && (
              <p className="action-feedback">
                This card shares its program. Changing the graph creates an independent copy; input
                values belong to this card.
              </p>
            )}
          <div className={`action-builder ${inspecting ? 'inspecting' : ''}`}>
            <div className="action-graph-shell">
              <div className="action-graph-toolbar">
                <div className="action-add-wrap">
                  <button
                    className="action-add-button"
                    aria-expanded={adding}
                    onClick={() => {
                      setAdding(!adding)
                      if (!adding) setStepQuery('')
                    }}
                  >
                    + Add step
                  </button>
                  {adding && (
                    <div className="action-step-menu">
                      <input
                        type="search"
                        aria-label="Find an action"
                        placeholder="Find an action…"
                        value={stepQuery}
                        onChange={(event) => setStepQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') return
                          const match = types.find((type) =>
                            `${type.name} ${type.description} ${type.service?.name ?? ''}`
                              .toLowerCase()
                              .includes(stepQuery.toLowerCase()),
                          )
                          if (match) addNode(match)
                        }}
                      />
                      {[...new Set(types.map((type) => type.service?.name ?? 'Other'))].map(
                        (service) => {
                          const matches = types.filter(
                            (type) =>
                              (type.service?.name ?? 'Other') === service &&
                              `${type.name} ${type.description} ${service}`
                                .toLowerCase()
                                .includes(stepQuery.toLowerCase()),
                          )
                          return matches.length ? (
                            <section className="action-service-group" key={service}>
                              <h3>{service}</h3>
                              {matches.map((type) => (
                                <button key={type.type} onClick={() => addNode(type)}>
                                  <span>
                                    <strong>{type.name}</strong>
                                    <small>{type.description}</small>
                                  </span>
                                </button>
                              ))}
                            </section>
                          ) : null
                        },
                      )}
                      {!types.some((type) =>
                        `${type.name} ${type.description} ${type.service?.name ?? ''}`
                          .toLowerCase()
                          .includes(stepQuery.toLowerCase()),
                      ) && <p>No matching actions</p>}
                    </div>
                  )}
                </div>
                <span>
                  {connecting
                    ? 'Choose an input · Escape cancels'
                    : 'Drag steps to arrange · connect the dots'}
                </span>
                <div className="action-zoom" aria-label="Graph zoom">
                  <button
                    aria-label="Card settings"
                    onClick={() => {
                      setSelected('start')
                      setSelectedEdge(null)
                      setInspecting(true)
                    }}
                  >
                    Settings
                  </button>
                  <button
                    aria-label="Zoom out"
                    onClick={() => setZoom(Math.max(0.25, zoom - 0.15))}
                  >
                    −
                  </button>
                  <span>{Math.round(zoom * 100)}%</span>
                  <button aria-label="Zoom in" onClick={() => setZoom(Math.min(1.75, zoom + 0.15))}>
                    +
                  </button>
                  <button onClick={fit}>Fit</button>
                </div>
              </div>
              <div
                className="action-graph-scroll"
                ref={canvas}
                onPointerMove={move}
                onPointerUp={(event) => {
                  drag.current = null
                  const input = (
                    document.elementFromPoint(event.clientX, event.clientY) ??
                    (event.target as HTMLElement)
                  )
                    .closest?.('[data-input]')
                    ?.getAttribute('data-input')
                  if (input && connecting) connect(input)
                }}
                onPointerCancel={() => {
                  drag.current = null
                  setConnecting(null)
                }}
              >
                <div
                  className="action-canvas-size"
                  style={{ width: width * zoom, height: height * zoom }}
                >
                  <div
                    className="action-canvas"
                    style={{
                      width,
                      height,
                      transform: `scale(${zoom})`,
                      transformOrigin: 'top left',
                    }}
                    onClick={(event) => {
                      if (event.target === event.currentTarget) {
                        setSelected('start')
                        setSelectedEdge(null)
                      }
                    }}
                  >
                    <svg
                      className="action-connections"
                      width={width}
                      height={height}
                      aria-label="Step connections"
                    >
                      {draft.edges.map((edge) => (
                        <g key={`${edge.from}:${edge.to}`}>
                          <path
                            className={`action-wire ${selectedEdge?.from === edge.from && selectedEdge.to === edge.to ? 'selected' : ''}`}
                            d={curve(point(edge.from, true), point(edge.to, false))}
                          />
                          <path
                            className="action-wire-hit"
                            d={curve(point(edge.from, true), point(edge.to, false))}
                            role="button"
                            tabIndex={0}
                            aria-label={`Connection from ${edge.from === 'start' ? 'Start' : draft.nodes.find((node) => node.id === edge.from)?.title} to ${draft.nodes.find((node) => node.id === edge.to)?.title}`}
                            onClick={() => {
                              setInspecting(true)
                              setSelectedEdge(edge)
                              setSelected('')
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                setInspecting(true)
                                setSelectedEdge(edge)
                                setSelected('')
                              }
                            }}
                          />
                        </g>
                      ))}
                      {connecting && (
                        <path
                          className="action-wire preview"
                          d={curve(point(connecting, true), pointer)}
                        />
                      )}
                    </svg>
                    <div
                      className={`action-node action-start ${selected === 'start' ? 'selected' : ''}`}
                      style={{ left: start.x, top: start.y }}
                    >
                      <button
                        className="action-node-body"
                        onClick={() => {
                          setInspecting(true)
                          setSelected('start')
                          setSelectedEdge(null)
                        }}
                      >
                        <span className="action-node-kind">Start</span>
                        <strong>Run card</strong>
                        <small>Saved card inputs</small>
                      </button>
                      {port('start', true, 'Start')}
                    </div>
                    {draft.nodes.map((node) => (
                      <div
                        key={node.id}
                        className={`action-node ${selected === node.id ? 'selected' : ''} state-${activeRun?.nodes[node.id]?.status ?? 'idle'}`}
                        style={{ left: node.x, top: node.y }}
                      >
                        {port(node.id, false, node.title)}
                        <button
                          className="action-node-body"
                          onClick={() => {
                            setInspecting(true)
                            setSelected(node.id)
                            setSelectedEdge(null)
                          }}
                          onPointerDown={(event) => {
                            if (event.button !== 0) return
                            drag.current = {
                              id: node.id,
                              x: node.x,
                              y: node.y,
                              clientX: event.clientX,
                              clientY: event.clientY,
                            }
                            event.currentTarget.setPointerCapture(event.pointerId)
                            setSelected(node.id)
                            setSelectedEdge(null)
                          }}
                        >
                          <span className="action-node-kind">
                            {findType(types, node.type)?.name ?? node.type}
                            {activeRun?.nodes[node.id] && (
                              <span>{statusLabel(activeRun.nodes[node.id].status)}</span>
                            )}
                          </span>
                          <strong>{node.title}</strong>
                          <small>{nodeSummary(node, draft.inputs ?? [])}</small>
                        </button>
                        {port(node.id, true, node.title)}
                      </div>
                    ))}
                    {!draft.nodes.length && (
                      <div className="action-canvas-empty">
                        <strong>No steps yet</strong>
                        <p>Choose an action from a service.</p>
                        <button onClick={() => setAdding(true)}>Add step</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            {inspecting && (
              <aside className="action-inspector">
                <button
                  className="action-inspector-close"
                  aria-label="Close step settings"
                  onClick={() => setInspecting(false)}
                >
                  Close
                </button>
                {currentNode ? (
                  <>
                    <h2>{currentType?.name ?? currentNode.title}</h2>
                    <label className="action-field">
                      <span>Step title</span>
                      <input
                        value={currentNode.title}
                        maxLength={80}
                        onChange={(event) =>
                          updateNode(currentNode.id, { title: event.target.value })
                        }
                      />
                    </label>
                    <p className="action-inspector-description">
                      {currentType?.description ??
                        'This step’s plugin is unavailable. Install or enable it to run this flow.'}
                    </p>
                    {currentType?.fields.map((field) => (
                      <ConfigField
                        presentations={presentations}
                        key={`${currentNode.id}:${field.key}:${bindingId(currentNode.bindings?.[field.key]) || 'custom'}`}
                        field={field}
                        config={currentConfig}
                        inputs={draft.inputs ?? []}
                        binding={currentNode.bindings?.[field.key]}
                        changeInput={(key, value) =>
                          setDraft({
                            ...draft,
                            inputs: draft.inputs?.map((input) =>
                              input.key === key ? { ...input, value } : input,
                            ),
                          })
                        }
                        expose={(show) => exposeField(field, show)}
                        sources={draft.nodes
                          .filter(
                            (node) =>
                              node.id !== currentNode.id &&
                              (draft.edges.some(
                                (edge) => edge.from === node.id && edge.to === currentNode.id,
                              ) ||
                                !connectionError(draft.edges, node.id, currentNode.id)),
                          )
                          .flatMap((node) =>
                            (findType(types, node.type)?.outputs ?? [])
                              .filter((output) => compatibleInput(field.kind, output.kind))
                              .map((output) => ({
                                reference: { step: node.id, path: [output.key] },
                                label: `${node.title} → ${output.label}`,
                              })),
                          )}
                        bind={(key) => {
                          const bindings = { ...currentNode.bindings }
                          if (key) bindings[field.key] = key
                          else delete bindings[field.key]
                          const sourceStep = key ? stepKey(key) : undefined
                          setDraft({
                            ...draft,
                            edges:
                              sourceStep &&
                              !draft.edges.some(
                                (edge) => edge.from === sourceStep && edge.to === currentNode.id,
                              )
                                ? [...draft.edges, { from: sourceStep, to: currentNode.id }]
                                : draft.edges,
                            nodes: draft.nodes.map((node) =>
                              node.id === currentNode.id
                                ? {
                                    ...node,
                                    bindings,
                                    config: {
                                      ...node.config,
                                      [field.key]: clone(
                                        currentConfig[field.key] ?? node.config[field.key] ?? '',
                                      ),
                                    },
                                  }
                                : node,
                            ),
                          })
                        }}
                        desktop={desktop}
                        change={(key, value) =>
                          updateNode(currentNode.id, {
                            config: { ...currentNode.config, [key]: value },
                          })
                        }
                      />
                    ))}
                    <details className="action-incoming">
                      <summary>Connections &amp; position</summary>
                      <p>Waits for all connected steps to succeed.</p>
                      {draft.edges
                        .filter(
                          (edge) => edge.to === currentNode.id || edge.from === currentNode.id,
                        )
                        .map((edge) => (
                          <div key={`${edge.from}:${edge.to}`}>
                            <span>
                              {edge.from === 'start'
                                ? 'Start'
                                : draft.nodes.find((node) => node.id === edge.from)?.title}{' '}
                              → {draft.nodes.find((node) => node.id === edge.to)?.title}
                            </span>
                            <button
                              aria-label="Remove connection"
                              onClick={() =>
                                setDraft({
                                  ...draft,
                                  edges: draft.edges.filter((item) => item !== edge),
                                })
                              }
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      <label>
                        X
                        <input
                          type="number"
                          min={0}
                          max={8000}
                          value={Math.round(currentNode.x)}
                          onChange={(event) =>
                            updateNode(currentNode.id, {
                              x: Math.max(0, Number(event.target.value)),
                            })
                          }
                        />
                      </label>
                      <label>
                        Y
                        <input
                          type="number"
                          min={0}
                          max={8000}
                          value={Math.round(currentNode.y)}
                          onChange={(event) =>
                            updateNode(currentNode.id, {
                              y: Math.max(0, Number(event.target.value)),
                            })
                          }
                        />
                      </label>
                    </details>
                    {currentState && (
                      <div className="action-node-result">
                        <strong>{statusLabel(currentState.status)}</strong>
                        {currentState.error && <p className="action-error">{currentState.error}</p>}
                        {currentState.output && <pre>{currentState.output}</pre>}
                        {currentState.result !== undefined && (
                          <details>
                            <summary>Result data</summary>
                            <pre>{JSON.stringify(currentState.result, null, 2)}</pre>
                          </details>
                        )}
                      </div>
                    )}
                    <button
                      className="action-remove"
                      onClick={() => {
                        const nodes = draft.nodes.filter((node) => node.id !== currentNode.id)
                        const usedHere = Object.values(currentNode.bindings ?? {}).map(inputKey)
                        setDraft({
                          ...draft,
                          nodes,
                          inputs: draft.inputs?.filter(
                            (input) =>
                              !usedHere.includes(input.key) ||
                              nodes.some((node) =>
                                Object.values(node.bindings ?? {}).some(
                                  (ref) => inputKey(ref) === input.key,
                                ),
                              ),
                          ),
                          edges: draft.edges.filter(
                            (edge) => edge.from !== currentNode.id && edge.to !== currentNode.id,
                          ),
                        })
                        setSelected('start')
                        setConnecting(null)
                      }}
                    >
                      Remove step
                    </button>
                  </>
                ) : selectedEdge ? (
                  <>
                    <span className="actions-eyebrow">CONNECTION</span>
                    <h2>Run after success</h2>
                    <p>
                      The next step starts when all its incoming steps succeed. A failed step skips
                      the steps that depend on it.
                    </p>
                    <button
                      className="action-remove"
                      onClick={() => {
                        setDraft({
                          ...draft,
                          edges: draft.edges.filter(
                            (edge) =>
                              edge.from !== selectedEdge.from || edge.to !== selectedEdge.to,
                          ),
                        })
                        setSelectedEdge(null)
                      }}
                    >
                      Remove connection
                    </button>
                  </>
                ) : (
                  <>
                    <h2>Card settings</h2>
                    <label className="action-field">
                      <span>Description</span>
                      <textarea
                        rows={3}
                        value={draft.description}
                        maxLength={240}
                        placeholder="A reminder of what this action does"
                        onChange={(event) =>
                          setDraft({ ...draft, description: event.target.value })
                        }
                      />
                    </label>
                    <CardInputsEditor
                      presentations={presentations}
                      inputs={draft.inputs ?? []}
                      desktop={desktop}
                      change={(inputs) => setDraft({ ...draft, inputs })}
                      remove={removeInput}
                    />
                    {activeRun && <p role="status">Last run: {statusLabel(activeRun.status)}</p>}
                  </>
                )}
              </aside>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="actions-list-bar">
            <span>
              {flows.length} {flows.length === 1 ? 'ACTION' : 'ACTIONS'}
            </span>
            <input
              type="search"
              aria-label="Filter actions"
              placeholder="Find an action…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {loading ? (
            <p className="actions-empty">Loading your actions…</p>
          ) : flows.length === 0 ? (
            <div className="actions-empty">
              <h2>No actions yet</h2>
              <p>Add an action, choose steps, and save its settings.</p>
              <button className="primary" onClick={() => edit(blank())}>
                New action
              </button>
            </div>
          ) : (
            <div className="actions-grid">
              {flows
                .filter((flow) =>
                  `${flow.title} ${flow.description}`.toLowerCase().includes(query.toLowerCase()),
                )
                .map((flow) => (
                  <ActionCard
                    reportError={setError}
                    key={flow.id}
                    flow={flow}
                    run={runs[flow.id]}
                    types={types}
                    desktop={desktop}
                    presentations={presentations}
                    edit={edit}
                    duplicate={(flow) => void duplicate(flow)}
                    remove={(flow) => void remove(flow)}
                    cancel={(id) => void cancel(id)}
                    dragStart={(event) => {
                      event.dataTransfer.setData('text/plain', flow.id)
                      setDragging(flow.id)
                    }}
                    dragEnd={() => setDragging(null)}
                    drop={() => void dropCard(flow.id)}
                  />
                ))}
              {query &&
                !flows.some((flow) =>
                  `${flow.title} ${flow.description}`.toLowerCase().includes(query.toLowerCase()),
                ) && <p>No matching actions.</p>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
