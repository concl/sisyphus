import type { ChatToolActivity } from '@sisyphus/sdk'

/** Collapsible audit trail for the tools a reply used, including their output. */
export function ToolActivity({ items }: { items: ChatToolActivity[] }) {
  return (
    <div className="chat-tools">
      {items.map((item) => (
        <details key={item.id}>
          <summary>
            <span className={`chat-tool-status ${item.status}`} />
            {item.name}
            <small>{item.status}</small>
          </summary>
          <div className="chat-tool-body">
            <span className="chat-tool-label">Input</span>
            <pre>{JSON.stringify(item.input, null, 2)}</pre>
            {item.output && (
              <>
                <span className="chat-tool-label">Result</span>
                <pre>{item.output}</pre>
              </>
            )}
          </div>
        </details>
      ))}
    </div>
  )
}
