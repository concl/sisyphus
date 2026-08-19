import type { ExtensionPage } from '@sisyphus/shared'
import { HomePage } from './HomePage'
import icon from './icon.svg?raw'

/** First-party extension: the landing page. */
export const homeExtension = {
  id: 'home',
  title: 'Home',
  icon,
  keepAlive: false,
  component: () => <HomePage />,
} as const satisfies ExtensionPage
