import * as React from 'react'
import type { ExtensionPage } from '@sisyphus/shared'
import { registerExtensionPages } from './registry'

/** Key-value data storage, scoped to a single extension (or the app). */
export interface ExtensionStorage {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
}

/** Host SDK handed to each runtime extension's `register(host)` function. */
export interface ExtensionHost {
  React: typeof React
  registerPages: (pages: ExtensionPage[]) => void
  storage: ExtensionStorage
}

function makeStorage(scope: string): ExtensionStorage {
  const bridge = window.sisyphus?.storage
  if (!bridge) {
    return {
      get: async () => undefined,
      set: async () => {},
      delete: async () => {},
    }
  }
  return {
    get: (key) => bridge.get(scope, key),
    set: (key, value) => bridge.set(scope, key, value),
    delete: (key) => bridge.delete(scope, key),
  }
}

/**
 * Loads runtime extensions from the store (userData/extensions, managed by
 * the main process). Each entry module exports `register(host)`; entries are
 * plain ESM served over the privileged sisyphus-ext:// protocol. Every
 * extension gets a host whose `storage` is scoped to its own id.
 */
export async function loadRuntimeExtensions(): Promise<void> {
  if (!window.sisyphus) return
  try {
    const listed = await window.sisyphus.extensions.list()
    for (const ext of listed) {
      try {
        const host: ExtensionHost = {
          React,
          registerPages: registerExtensionPages,
          storage: makeStorage(ext.id),
        }
        const module = (await import(/* @vite-ignore */ ext.url)) as {
          register?: (host: ExtensionHost) => void
        }
        module.register?.(host)
        if (ext.styleUrl) {
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href = ext.styleUrl
          document.head.appendChild(link)
        }
      } catch (err) {
        console.error(`[extensions] failed to load ${ext.id}@${ext.version}:`, err)
      }
    }
  } catch (err) {
    console.error('[extensions] failed to list runtime extensions:', err)
  }
}
