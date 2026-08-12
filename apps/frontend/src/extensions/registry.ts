import type { ExtensionPage } from '@sisyphus/shared'
import { pages as builtinPages } from './index'

/**
 * Runtime page registry. Starts from the compile-time pages in extensions/;
 * runtime extensions append via `registerExtensionPages` (see loader.ts).
 * React components read the list with `useSyncExternalStore(subscribePages,
 * getPages)`.
 */
let current: readonly ExtensionPage[] = builtinPages
const listeners = new Set<() => void>()

export function getPages(): readonly ExtensionPage[] {
  return current
}

export function registerExtensionPages(added: ExtensionPage[]): void {
  current = [...current, ...added]
  for (const listener of listeners) listener()
}

export function subscribePages(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
