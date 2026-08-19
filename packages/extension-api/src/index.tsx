import type { ExtensionPage } from '@sisyphus/shared'
import { ApiPage } from './ApiPage'
import icon from './icon.svg?raw'

/** Concept extension: a frontend for the python-host FastAPI service. */
export const apiExtension = {
  id: 'api',
  title: 'Python API',
  icon,
  keepAlive: false,
  component: () => <ApiPage />,
} as const satisfies ExtensionPage
