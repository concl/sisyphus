import { memo, useEffect, useRef } from 'react'
import { Streamdown } from 'streamdown'
import { FolderIcon } from '@sisyphus/ui'
import type {
  ChatConfig,
  ChatMessage,
  ChatMessagePart,
  ChatThread,
  ChatToolActivity,
} from '@sisyphus/sdk'
import icon from './icon.svg'
import { MessageEditor } from './message-editor'
import { ToolCall } from './tool-activity'
import { folderLabel } from './format'
import { messageParts, type LiveTranscript } from './transcript'
import { activePath, branchOf, siblings } from './tree'

interface MessageListProps {
  thread: ChatThread | null
  config: ChatConfig | null
  busy: boolean
  live: LiveTranscript
  folder: string | null
  /** The message currently being edited, so its turn opens into its own editor. */
  editingId: string | null
  onSuggestion(text: string): void
  onChooseFolder(): void
  onConfigure(): void
  onEdit(message: ChatMessage): void
  onSwitchBranch(message: ChatMessage): void
  /** Saves the message being edited as a new version and sends it. */
  onSubmitEdit(text: string): void
  onCancelEdit(): void
}

const SUGGESTIONS = ['Help me plan my day', 'What can you help me with?']

// Streamdown renders semantic HTML; the module chrome comes from chat.css, so
// only the controls it should show are enabled here.
const CONTROLS = {
  code: { copy: true, download: false },
  table: { copy: true, download: false, fullscreen: false },
}

const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="chat-markdown">
      <Streamdown controls={CONTROLS}>{text}</Streamdown>
    </div>
  )
})

/**
 * What the model thought before answering. Reasoning is long and usually
 * disposable, so it folds away - open while it streams, closed once the answer
 * itself starts.
 */
function Reasoning({ text, open }: { text: string; open: boolean }) {
  return (
    <details className="chat-reasoning" open={open}>
      <summary>Reasoning</summary>
      <div className="chat-reasoning-text">{text}</div>
    </details>
  )
}

/**
 * Assistant output in the order it happened: reasoning, markdown, tool calls,
 * more markdown. A notice is the app speaking, not the model, so it never joins
 * the answer's text.
 */
function Parts({
  parts,
  tools,
  live = false,
}: {
  parts: ChatMessagePart[]
  tools: ChatToolActivity[]
  live?: boolean
}) {
  const byId = new Map(tools.map((tool) => [tool.id, tool]))
  return (
    <>
      {parts.map((part, index) => {
        if (part.type === 'notice')
          return (
            <p className="chat-notice" key={`notice-${index}`}>
              {part.text}
            </p>
          )
        // Only the newest part of a running reply is still growing.
        if (part.type === 'reasoning')
          return (
            <Reasoning
              key={`reasoning-${index}`}
              text={part.text}
              open={live && index === parts.length - 1}
            />
          )
        if (part.type === 'text') return <Markdown key={`text-${index}`} text={part.text} />
        const tool = byId.get(part.toolId)
        return tool ? <ToolCall key={part.toolId} tool={tool} /> : null
      })}
    </>
  )
}

/**
 * The other attempts at this turn, if there are any. Editing a message leaves the
 * original in place and answers its parent, so the versions sit side by side and
 * only the selected branch is shown.
 */
function VersionSwitch({
  thread,
  message,
  disabled,
  onSwitch,
}: {
  thread: ChatThread
  message: ChatMessage
  disabled: boolean
  onSwitch(message: ChatMessage): void
}) {
  const branch = branchOf(thread.messages, message)
  if (branch.count < 2) return null
  const versions = siblings(thread.messages, message)
  const previous = versions[branch.index - 1]
  const next = versions[branch.index + 1]
  return (
    <span
      className="chat-version"
      role="group"
      aria-label={`Version ${branch.index + 1} of ${branch.count}`}
    >
      <button
        type="button"
        disabled={disabled || !previous}
        onClick={() => previous && onSwitch(previous)}
        aria-label="Previous version"
        title="Previous version"
      >
        {'\u2039'}
      </button>
      <span className="chat-version-count">
        {branch.index + 1}/{branch.count}
      </span>
      <button
        type="button"
        disabled={disabled || !next}
        onClick={() => next && onSwitch(next)}
        aria-label="Next version"
        title="Next version"
      >
        {'\u203a'}
      </button>
    </span>
  )
}

function Message({
  message,
  thread,
  busy,
  editing,
  onEdit,
  onSwitchBranch,
  onSubmitEdit,
  onCancelEdit,
}: {
  message: ChatMessage
  thread: ChatThread
  busy: boolean
  editing: boolean
  onEdit(message: ChatMessage): void
  onSwitchBranch(message: ChatMessage): void
  onSubmitEdit(text: string): void
  onCancelEdit(): void
}) {
  const parts = messageParts(message)
  // Replies stored before notices were their own part still say their piece.
  const notice =
    message.notice && !parts.some((part) => part.type === 'notice') ? message.notice : ''
  return (
    <article
      className={`chat-message ${message.role}${editing ? ' editing' : ''}`}
      key={message.id}
    >
      <div className="chat-message-label">
        {message.role === 'user' ? 'You' : 'Sisyphus'}
        {/* Which message is open for editing is said here, in the message. */}
        {editing && <small>Editing</small>}
        {message.status === 'stopped' && <small>Stopped</small>}
        {message.role === 'user' && (
          <VersionSwitch
            thread={thread}
            message={message}
            disabled={busy}
            onSwitch={onSwitchBranch}
          />
        )}
        {message.role === 'user' && !busy && !editing && (
          <button
            type="button"
            className="chat-edit"
            onClick={() => onEdit(message)}
            title="Edit this message and send it again as a new version"
          >
            Edit
          </button>
        )}
      </div>
      {/* Your own words open into a box in place; the model's answer renders. */}
      {message.role === 'assistant' ? (
        <Parts parts={parts} tools={message.tools ?? []} />
      ) : editing ? (
        <MessageEditor
          text={message.text}
          busy={busy}
          onSave={onSubmitEdit}
          onCancel={onCancelEdit}
        />
      ) : (
        <div className="chat-text">{message.text}</div>
      )}
      {notice && <p className="chat-notice">{notice}</p>}
      {/* A stop is the user's own doing; a failure is the provider's. They are
          not the same thing, and neither is model output. */}
      {message.error && message.status === 'stopped' && (
        <p className="chat-notice">{message.error}</p>
      )}
      {message.error && message.status !== 'stopped' && (
        <div className="chat-failure" role="alert">
          <strong>Request failed</strong>
          <p>{message.error}</p>
        </div>
      )}
    </article>
  )
}

/** Transcript for the open thread, including the live reply for the current run. */
export function MessageList({
  thread,
  config,
  busy,
  live,
  folder,
  editingId,
  onSuggestion,
  onChooseFolder,
  onConfigure,
  onEdit,
  onSwitchBranch,
  onSubmitEdit,
  onCancelEdit,
}: MessageListProps) {
  const bottom = useRef<HTMLDivElement | null>(null)
  // Only the branch on screen is rendered.
  const messages = activePath(thread)

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [live, thread])

  return (
    <div className="chat-messages" aria-live="polite">
      {!messages.length && !busy && (
        <div className="chat-welcome">
          <span className="icon-mask" style={{ maskImage: `url("${icon}")` }} aria-hidden="true" />
          <h2>A little help, right here.</h2>
          <p>Talk through an idea, plan your day, or work with your to-dos.</p>
          {config?.model ? (
            <>
              <div className="chat-suggestions">
                {SUGGESTIONS.map((text) => (
                  <button key={text} onClick={() => onSuggestion(text)}>
                    {text}
                  </button>
                ))}
              </div>
              <button className="chat-welcome-folder" onClick={onChooseFolder}>
                <FolderIcon />
                {folder
                  ? `${folderLabel(folder)} - @ to reference a file`
                  : 'Attach a folder for file and command tools (optional)'}
              </button>
            </>
          ) : (
            <button className="primary" onClick={onConfigure}>
              Configure a model in Settings
            </button>
          )}
        </div>
      )}
      {thread &&
        messages.map((message) => (
          <Message
            key={message.id}
            message={message}
            thread={thread}
            busy={busy}
            editing={editingId === message.id}
            onEdit={onEdit}
            onSwitchBranch={onSwitchBranch}
            onSubmitEdit={onSubmitEdit}
            onCancelEdit={onCancelEdit}
          />
        ))}
      {busy && (
        <article className="chat-message assistant">
          <div className="chat-message-label">
            Sisyphus <small>Working...</small>
          </div>
          {live.parts.length ? (
            <Parts parts={live.parts} tools={live.tools} live />
          ) : (
            <div className="chat-text">
              {live.tools.length ? 'Using app tools...' : 'Connecting to your model...'}
            </div>
          )}
        </article>
      )}
      <div ref={bottom} />
    </div>
  )
}
