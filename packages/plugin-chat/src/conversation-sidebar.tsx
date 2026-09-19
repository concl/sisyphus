import { ChevronLeftIcon, PlusIcon } from '@sisyphus/ui'
import type { ThreadSummary } from './types'
import { folderLabel, formatDay } from './format'

interface ConversationSidebarProps {
  threads: ThreadSummary[]
  activeId?: string
  busy: boolean
  onSelect(id: string): void
  onNew(): void
  onCollapse(): void
}

/** Sidebar contents: start a conversation or reopen a stored one. */
export function ConversationSidebar({
  threads,
  activeId,
  busy,
  onSelect,
  onNew,
  onCollapse,
}: ConversationSidebarProps) {
  return (
    <div className="chat-sidebar-body">
      <div className="chat-sidebar-head">
        <h2>Conversations</h2>
        <button
          className="chat-icon-button"
          onClick={onCollapse}
          aria-label="Hide conversations"
          title="Hide conversations"
        >
          <ChevronLeftIcon />
        </button>
      </div>
      <button className="chat-new" disabled={busy} onClick={onNew}>
        <PlusIcon />
        New conversation
      </button>
      {threads.length ? (
        <nav className="chat-threads" aria-label="Stored conversations">
          {threads.map((item) => (
            <button
              key={item.id}
              className="chat-thread"
              data-active={item.id === activeId}
              aria-current={item.id === activeId ? 'true' : undefined}
              disabled={busy}
              onClick={() => onSelect(item.id)}
              title={item.title}
            >
              <span className="chat-thread-title">{item.title}</span>
              <small>
                {formatDay(item.updatedAt)}
                {item.folder ? ` · ${folderLabel(item.folder)}` : ''}
              </small>
            </button>
          ))}
        </nav>
      ) : (
        <p className="chat-threads-empty">No conversations yet.</p>
      )}
    </div>
  )
}
