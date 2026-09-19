import { useEffect, useRef } from 'react'
import { Streamdown } from 'streamdown'
import { FolderIcon } from '@sisyphus/ui'
import type { ChatConfig, ChatMessage, ChatThread, ChatToolActivity } from '@sisyphus/sdk'
import icon from './icon.svg'
import { ToolActivity } from './tool-activity'
import { folderLabel } from './format'

interface MessageListProps {
  thread: ChatThread | null
  config: ChatConfig | null
  busy: boolean
  reply: string
  activity: ChatToolActivity[]
  folder: string | null
  onSuggestion(text: string): void
  onChooseFolder(): void
  onConfigure(): void
}

const SUGGESTIONS = ['Help me plan my day', 'What can you help me with?']

/** Assistant replies arrive as Markdown, so they are rendered, not printed. */
function Body({ message }: { message: ChatMessage }) {
  if (message.role !== 'assistant') return <div className="chat-text">{message.text}</div>
  return (
    <div className="chat-markdown">
      <Streamdown>{message.text}</Streamdown>
    </div>
  )
}

/** Transcript for the open thread, including the live reply for the current run. */
export function MessageList({
  thread,
  config,
  busy,
  reply,
  activity,
  folder,
  onSuggestion,
  onChooseFolder,
  onConfigure,
}: MessageListProps) {
  const bottom = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [reply, thread, activity])

  return (
    <div className="chat-messages" aria-live="polite">
      {!thread?.messages.length && !busy && (
        <div className="chat-welcome">
          <img src={icon} alt="" />
          <h2>A little help, right here.</h2>
          <p>Talk through an idea, plan your day, or work with your to-dos.</p>
          {config?.model ? (
            <>
              <div className="chat-suggestions">
                {SUGGESTIONS.map((text) => (
                  <button key={text} onClick={() => onSuggestion(text)}>
                    {text} ↗
                  </button>
                ))}
              </div>
              <button className="chat-welcome-folder" onClick={onChooseFolder}>
                <FolderIcon />
                {folder
                  ? `${folderLabel(folder)} — @ to reference a file`
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
      {thread?.messages.map((message) => (
        <article className={`chat-message ${message.role}`} key={message.id}>
          <div className="chat-message-label">
            {message.role === 'user' ? 'You' : 'Sisyphus'}
            {message.status === 'stopped' && <small>Stopped</small>}
          </div>
          {message.tools?.length ? <ToolActivity items={message.tools} /> : null}
          <Body message={message} />
          {message.error && (
            <p className="error" role="alert">
              {message.error}
            </p>
          )}
        </article>
      ))}
      {busy && (
        <article className="chat-message assistant">
          <div className="chat-message-label">
            Sisyphus <small>Working…</small>
          </div>
          <ToolActivity items={activity} />
          {reply ? (
            <div className="chat-markdown">
              <Streamdown>{reply}</Streamdown>
            </div>
          ) : (
            <div className="chat-text">
              {activity.length ? 'Using app tools…' : 'Connecting to your model…'}
            </div>
          )}
        </article>
      )}
      <div ref={bottom} />
    </div>
  )
}
