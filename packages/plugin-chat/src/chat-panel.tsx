import { useRef } from 'react'
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
  const mentionItems = useFileMentions(desktop, chat.folder)
  const openSettings = () => panels.open('settings')

  function selectConversation(id: string) {
    if (compact) sidebar.setOpen(false)
    void chat.openThread(id)
  }

  function startConversation() {
    if (compact) sidebar.setOpen(false)
    composer.current?.clear()
    void chat.openThread('')
  }

  // The draft stays in the editor unless the message actually went out.
  async function submit(text: string) {
    if (await chat.send(text)) composer.current?.clear()
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
          busy={chat.busy}
          onSelect={selectConversation}
          onNew={startConversation}
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
          reply={chat.reply}
          activity={chat.activity}
          folder={chat.folder}
          onSuggestion={(text) => composer.current?.insert(text)}
          onChooseFolder={() => void chat.chooseFolder()}
          onConfigure={openSettings}
        />
        {chat.error && (
          <p className="chat-error" role="alert">
            {chat.error}
          </p>
        )}
        <ChatComposer
          ref={composer}
          config={chat.config}
          busy={chat.busy}
          hasFolder={Boolean(chat.folder)}
          mentionItems={mentionItems}
          onSubmit={(text) => void submit(text)}
          onStop={chat.stop}
        />
      </div>
    </div>
  )
}
