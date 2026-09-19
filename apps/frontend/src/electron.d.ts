import type { Desktop } from '@sisyphus/sdk'
declare global {
  interface Window {
    sisyphus?: Desktop
  }
}
export {}
