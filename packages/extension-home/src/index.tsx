import type { ExtensionPage } from '@sisyphus/shared'
import { HomePage } from './HomePage'

/** First-party extension: the landing page. */
export const homeExtension = {
  id: 'home',
  title: 'Home',
  icon: 'icon-home',
  keepAlive: false,
  component: () => <HomePage />,
} as const satisfies ExtensionPage
