import type { ExtensionPage } from '@sisyphus/shared'
import { ApiPage } from './ApiPage'

/** Concept extension: a frontend for the python-host FastAPI service. */
export const apiExtension = {
  id: 'api',
  title: 'Python API',
  icon: 'icon-plug',
  keepAlive: false,
  component: () => <ApiPage />,
} as const satisfies ExtensionPage
