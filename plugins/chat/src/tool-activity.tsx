import type { ChatToolActivity } from '@sisyphus/sdk'

/** One tool call as a collapsed audit trail, including its input and result. */
export function ToolCall({ tool }: { tool: ChatToolActivity }) {
  return (
    <div className="chat-tools">
      <details>
        <summary>
          <span className={`chat-tool-status ${tool.status}`} />
          {tool.name}
          <small>{tool.status}</small>
        </summary>
        <div className="chat-tool-body">
          <span className="chat-tool-label">Input</span>
          <pre>{JSON.stringify(tool.input, null, 2)}</pre>
          {tool.output && (
            <>
              <span className="chat-tool-label">Result</span>
              <pre>{tool.output}</pre>
            </>
          )}
        </div>
      </details>
    </div>
  )
}
