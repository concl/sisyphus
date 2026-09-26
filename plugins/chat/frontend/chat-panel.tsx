import { useRef, useState } from 'react'
import { ChevronRightIcon, FolderIcon, PanelLeftIcon, ResizableSidebar } from '@sisyphus/ui'
import type { Desktop, Panels } from '@sisyphus/sdk'
import { ChatComposer, type ChatComposerHandle } from './composer'
import { ConversationSidebar } from './conversation-sidebar'
import { MessageList } from './message-list'
import { folderLabel } from './format'
import { useChat } from './use-chat'
import { useChatSidebar } from './use-chat-sidebar'
import { useFileMentions } from './use-file-mentions'
import 'tippy.js/dist/tippy.css'
import 'streamdown/styles.css'
import './chat.css'

export interface ChatPanelProps {
  panels: Panels
  desktop: Desktop
}

/**
 * Chat block layout: a resizable conversation sidebar next to the transcript and
 * composer. Narrow blocks switch the sidebar to an overlay.
 */
export function ChatPanel({ panels, desktop }: ChatPanelProps) {
  const chat = useChat(desktop)
  const { rootRef, compact, sidebar } = useChatSidebar()
  const composer = useRef<ChatComposerHandle>(null)
  const [dropPrompt, setDropPrompt] = useState<{
    files: File[]
    folder: string
    folderName: string
    names: string[]
  } | null>(null)
  const [dropError, setDropError] = useState('')
  const mentionItems = useFileMentions(desktop, chat.folder)
  const openSettings = () => panels.open('settings')
  // The message being edited, if any. Its own editor lives inside the message, so
  // the composer below keeps writing new messages and never holds an edit.
  const editingId = chat.editing?.id ?? null

  function selectConversation(id: string) {
    if (compact) sidebar.setOpen(false)
    void chat.openThread(id)
  }

  function startConversation() {
    if (compact) sidebar.setOpen(false)
    chat.cancelEdit()
    composer.current?.clear()
    void chat.openThread('')
  }

  // The draft stays in the composer unless the message actually went out.
  async function submit(text: string) {
    const submitted = composer.current
    if (await chat.send(text)) submitted?.clear()
  }

  async function dropFiles(files: File[], folder = chat.folder) {
    if (chat.busy) {
      setDropError('Wait for the current reply to finish before attaching files.')
      return
    }
    setDropError('')
    try {
      const result = await desktop.dropFiles(files, folder)
      if (result.status === 'accepted') {
        composer.current?.insertFiles(result.entries.map((entry) => entry.path))
        setDropPrompt(null)
      } else if (result.status === 'needs-folder') {
        setDropPrompt({
          files,
          folder: result.suggestedFolder,
          folderName: result.folderName,
          names: result.names,
        })
      } else setDropError(result.message)
    } catch (problem) {
      setDropError(String(problem))
    }
  }

  async function acceptDroppedFolder() {
    if (!dropPrompt) return
    const pending = dropPrompt
    if (!(await chat.attachFolder(pending.folder))) return
    await dropFiles(pending.files, pending.folder)
  }

  return (
    <div className="chat-panel" ref={rootRef} data-compact={compact}>
      <ResizableSidebar
        className="chat-sidebar"
        label="Conversations"
        width={sidebar.width}
        open={sidebar.open}
        resizing={sidebar.resizing}
        overlay={compact}
        handleProps={sidebar.handleProps}
      >
        <ConversationSidebar
          threads={chat.threads}
          activeId={chat.thread?.id}
          runningIds={chat.runningIds}
          defaultFolder={chat.defaultFolder}
          onSelect={selectConversation}
          onNew={startConversation}
          onDefaultFolder={chat.setDefaultFolder}
          onCollapse={() => sidebar.setOpen(false)}
        />
      </ResizableSidebar>
      {compact && sidebar.open && (
        <button
          className="chat-scrim"
          aria-label="Close conversations"
          onClick={() => sidebar.setOpen(false)}
        />
      )}
      <div className="chat-main">
        <header className="chat-toolbar">
          {/* In overlay mode the open sidebar covers this control, so the
              sidebar's own collapse button is the only one shown. */}
          {(!compact || !sidebar.open) && (
            <button
              className="chat-icon-button"
              onClick={sidebar.toggle}
              aria-expanded={sidebar.open}
              aria-label={sidebar.open ? 'Hide conversations' : 'Show conversations'}
              title={sidebar.open ? 'Hide conversations' : 'Show conversations'}
            >
              {sidebar.open ? <PanelLeftIcon /> : <ChevronRightIcon />}
            </button>
          )}
          <span className="chat-title" title={chat.thread?.title}>
            {chat.thread?.title || 'New conversation'}
          </span>
          {/* The folder belongs to this conversation, so it lives in its header. */}
          <button
            className="chat-folder"
            disabled={chat.busy}
            onClick={() => void chat.chooseFolder()}
            title={
              chat.folder ?? 'This chat has no folder. Attach one to read, edit, and run commands.'
            }
          >
            <FolderIcon />
            {chat.folder ? folderLabel(chat.folder) : 'No folder'}
          </button>
          {chat.thread && (
            <button
              disabled={chat.busy}
              onClick={() => void chat.removeThread()}
              title="Delete this local conversation"
            >
              Delete
            </button>
          )}
          <button onClick={openSettings} title="Configure model">
            Settings
          </button>
        </header>
        <MessageList
          thread={chat.thread}
          config={chat.config}
          busy={chat.busy}
          live={chat.live}
          folder={chat.folder}
          editingId={editingId}
          onSuggestion={(text) => composer.current?.insert(text)}
          onChooseFolder={() => void chat.chooseFolder()}
          onConfigure={openSettings}
          onEdit={(message) => chat.startEdit(message)}
          onSwitchBranch={(message) => void chat.switchBranch(message)}
          onSubmitEdit={(text) => void chat.submitEdit(text)}
          onCancelEdit={chat.cancelEdit}
        />
        {chat.error && (
          <p className="chat-error" role="alert">
            {chat.error}
          </p>
        )}
        {dropPrompt && (
          <div className="chat-drop-prompt" role="status">
            <span>
              Attach <strong>{dropPrompt.folderName}</strong> to mention{' '}
              {dropPrompt.names.length === 1
                ? dropPrompt.names[0]
                : `${dropPrompt.names.length} items`}
              ?
            </span>
            <button type="button" onClick={() => void acceptDroppedFolder()}>
              Attach folder
            </button>
            <button type="button" onClick={() => setDropPrompt(null)}>
              Cancel
            </button>
          </div>
        )}
        {dropError && <p className="chat-drop-error">{dropError}</p>}
        <ChatComposer
          key={chat.thread?.id ?? 'new'}
          ref={composer}
          config={chat.config}
          busy={chat.busy}
          hasFolder={Boolean(chat.folder)}
          mentionItems={mentionItems}
          onSubmit={(text) => void submit(text)}
          onStop={chat.stop}
          onDropFiles={(files) => void dropFiles(files)}
        />
        <div className="chat-context" title={chat.context?.estimated ? 'Estimated from the serialized model context; the provider did not report usage.' : 'Latest model input plus output, including tool calls and reasoning. No compaction is performed.'}>
          <span />{chat.context ? `${chat.context.estimated ? '~' : ''}${chat.context.tokens.toLocaleString()} tokens in context` : 'Context usage appears after a reply'}
        </div>
      </div>
    </div>
  )
}
