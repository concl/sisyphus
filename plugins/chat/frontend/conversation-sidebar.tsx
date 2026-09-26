import { ChevronLeftIcon, PlusIcon, type IconProps } from '@sisyphus/ui'
import type { ThreadSummary } from './types'
import { formatDay } from './format'
import { threadGroups } from './thread-groups'

interface ConversationSidebarProps {
  threads: ThreadSummary[]
  activeId?: string
  runningIds: string[]
  /** Folder new conversations start in; null when none is chosen. */
  defaultFolder: string | null
  onSelect(id: string): void
  onNew(): void
  onDefaultFolder(folder: string): void
  onCollapse(): void
}

/** Sidebar contents: start a conversation, or reopen a stored one by folder. */
export function ConversationSidebar({
  threads,
  activeId,
  runningIds,
  defaultFolder,
  onSelect,
  onNew,
  onDefaultFolder,
  onCollapse,
}: ConversationSidebarProps) {
  const groups = threadGroups(threads)
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
      <button
        className="chat-new"
        onClick={onNew}
        title={defaultFolder ? `New conversation in ${defaultFolder}` : 'New conversation'}
      >
        <PlusIcon />
        New conversation
      </button>
      {threads.length ? (
        <nav className="chat-threads" aria-label="Stored conversations">
          {groups.map((group) => {
            const folder = group.folder
            const selected = folder !== null && folder === defaultFolder
            return (
              // A group is one folder's conversations, and its heading is where
              // that folder can be made the place new conversations start.
              <section className="chat-folder-group" key={folder ?? ''}>
                <div className="chat-folder-head">
                  <span className="chat-folder-label">
                    <span className="chat-folder-name" title={folder ?? undefined}>
                      {group.label}
                    </span>
                    {group.detail && <small title={group.detail}>{group.detail}</small>}
                  </span>
                  {folder && (
                    <button
                      className="chat-icon-button chat-folder-default"
                      data-selected={selected}
                      aria-pressed={selected}
                      onClick={() => onDefaultFolder(folder)}
                      aria-label={
                        selected
                          ? `Stop starting new conversations in ${folder}`
                          : `Start new conversations in ${folder}`
                      }
                      title={
                        selected
                          ? `New conversations start in ${folder} · click to clear`
                          : `Start new conversations in ${folder}`
                      }
                    >
                      <PencilBoxIcon />
                    </button>
                  )}
                </div>
                {group.threads.map((item) => (
                  <button
                    key={item.id}
                    className="chat-thread"
                    data-active={item.id === activeId}
                    aria-current={item.id === activeId ? 'true' : undefined}
                    onClick={() => onSelect(item.id)}
                    title={item.title}
                  >
                    <span className="chat-thread-title">{item.title}</span>
                    <small>
                      {runningIds.includes(item.id) ? 'Working · ' : ''}
                      {formatDay(item.updatedAt)}
                    </small>
                  </button>
                ))}
              </section>
            )
          })}
        </nav>
      ) : (
        <p className="chat-threads-empty">No conversations yet.</p>
      )}
    </div>
  )
}

/** A box with a pen: choosing the folder new conversations are added to. */
function PencilBoxIcon({ size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8.4 4.2H3.4a1.6 1.6 0 0 0-1.6 1.6v6.2a1.6 1.6 0 0 0 1.6 1.6h6.2a1.6 1.6 0 0 0 1.6-1.6V8.9" />
      <path d="M9.9 2.9l1.6 1.6-5.2 5.2-2.1.5.5-2.1z" />
    </svg>
  )
}
