import type { ExtensionPage } from '@sisyphus/shared'
import { TerminalPage } from './TerminalPage'

/** First-party extension: the terminal page (node-pty shells via IPC). */
export const terminalExtension = {
  id: 'terminal',
  title: 'Terminal',
  icon: 'icon-terminal',
  // Live PTYs must survive page switches, so never unmount this page.
  keepAlive: true,
  component: TerminalPage,
} as const satisfies ExtensionPage
