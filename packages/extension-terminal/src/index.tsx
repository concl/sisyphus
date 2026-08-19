import type { ExtensionPage } from '@sisyphus/shared'
import { TerminalPage } from './TerminalPage'
import icon from './icon.svg?raw'

/** First-party extension: the terminal page (node-pty shells via IPC). */
export const terminalExtension = {
  id: 'terminal',
  title: 'Terminal',
  icon,
  // Live PTYs must survive page switches, so never unmount this page.
  keepAlive: true,
  component: TerminalPage,
} as const satisfies ExtensionPage
