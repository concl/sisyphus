import {
  findType,
  nodeSummary,
  orderedSteps,
  type Flow,
  type Run,
  type StepType,
  type ReadinessIssue,
} from './action-model'

export function WorkflowOutline({
  flow,
  types,
  selected,
  select,
  add,
  run,
  issues,
}: {
  flow: Flow
  types: StepType[]
  selected: string
  select: (id: string) => void
  add: () => void
  run?: Run
  issues: ReadinessIssue[]
}) {
  return (
    <div className="workflow-outline">
      <div className="workflow-outline-heading">
        <span className="action-kicker">YOUR WORKFLOW</span>
        <p>Each step waits for its dependencies. Use Graph to build branches.</p>
      </div>
      <button
        className={`workflow-start ${selected === 'start' ? 'selected' : ''}`}
        onClick={() => select('start')}
      >
        <span aria-hidden="true">▷</span>
        <span>
          <strong>Start</strong>
          <small>One click · saved card inputs</small>
        </span>
        <span>Card settings ›</span>
      </button>
      <ol>
        {orderedSteps(flow).map((node, index) => {
          const action = findType(types, node.type)
          const problems = issues.filter((issue) => issue.nodeId === node.id)
          const dependencies = flow.edges
            .filter((edge) => edge.to === node.id)
            .map((edge) =>
              edge.from === 'start'
                ? 'Start'
                : (flow.nodes.find((item) => item.id === edge.from)?.title ?? 'Missing step'),
            )
          return (
            <li key={node.id}>
              <button
                className={`workflow-step ${selected === node.id ? 'selected' : ''}`}
                onClick={() => select(node.id)}
                aria-label={`Step ${index + 1}: ${node.title}`}
                aria-pressed={selected === node.id}
              >
                <span
                  className={`workflow-step-number ${problems.length ? 'needs-attention' : ''}`}
                >
                  {index + 1}
                </span>
                <span className="workflow-step-copy">
                  <small>
                    {action?.service?.name ?? 'Unavailable provider'} · {action?.name ?? node.type}
                  </small>
                  <strong>{node.title}</strong>
                  <span>{nodeSummary(node, flow.inputs)}</span>
                  <small>
                    After: {dependencies.length ? dependencies.join(' + ') : 'Not connected'}
                  </small>
                </span>
                <span
                  className={`workflow-step-status ${problems.length ? 'needs-attention' : ''}`}
                >
                  {run?.nodes[node.id]?.status ?? (problems.length ? 'Needs setup' : '›')}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      {!flow.nodes.length && (
        <div className="workflow-welcome">
          <span aria-hidden="true">＋</span>
          <h2>What would you like to automate?</h2>
          <p>
            Start with one action. Add more steps and pass their results along as your workflow
            grows.
          </p>
        </div>
      )}
      <button className="workflow-add" onClick={add}>
        ＋ {flow.nodes.length ? 'Add a step' : 'Choose your first action'}
      </button>
    </div>
  )
}
