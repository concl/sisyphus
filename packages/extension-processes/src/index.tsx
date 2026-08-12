import type { ExtensionPage } from '@sisyphus/shared'
import { ProcessesPage } from './ProcessesPage'

/** Concept extension: live view of the subprocesses the app manages. */
export const processesExtension = {
  id: 'processes',
  title: 'Processes',
  icon: 'icon-cpu',
  keepAlive: false,
  component: () => <ProcessesPage />,
} as const satisfies ExtensionPage
