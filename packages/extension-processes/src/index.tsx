import type { ExtensionPage } from '@sisyphus/shared'
import { ProcessesPage } from './ProcessesPage'
import icon from './icon.svg?raw'

/** Concept extension: live view of the subprocesses the app manages. */
export const processesExtension = {
  id: 'processes',
  title: 'Processes',
  icon,
  keepAlive: false,
  component: () => <ProcessesPage />,
} as const satisfies ExtensionPage
