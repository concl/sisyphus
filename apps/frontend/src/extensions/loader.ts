import * as React from 'react'
import type { ExtensionPage, ListedExtension } from '@sisyphus/shared'
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
 * Fills in page icons from the extension's manifest: each page may declare
 * `"icon": "icon.svg"` (a file in the extension's store dir), and the main
 * process lists the resolved icon URL per page. The SVG markup is fetched and
 * inlined into the page descriptor, so extensions own their icons. Missing or
 * failed icons leave the page without one (the sidebar falls back).
 */
async function attachIcons(pages: ExtensionPage[], ext: ListedExtension): Promise<void> {
  const declared = new Map(ext.pages.map((p) => [p.id, p]))
  await Promise.all(
    pages.map(async (page) => {
      if (page.icon) return
      const iconUrl = declared.get(page.id)?.iconUrl
      if (!iconUrl) return
      try {
        const res = await fetch(iconUrl)
        if (res.ok) page.icon = await res.text()
      } catch (err) {
        console.error(`[extensions] failed to load icon for ${page.id}@${ext.version}:`, err)
      }
    }),
  )
}

/**
 * Loads runtime extensions from the store (userData/extensions, managed by
 * the main process). Each entry module exports `register(host)`; entries are
 * plain ESM served over the privileged sisyphus-ext:// protocol. Every
 * extension gets a host whose `storage` is scoped to its own id and whose
 * `registerPages` resolves the extension's own icons before registering.
 */
export async function loadRuntimeExtensions(): Promise<void> {
  if (!window.sisyphus) return
  try {
    const listed = await window.sisyphus.extensions.list()
    for (const ext of listed) {
      try {
        const host: ExtensionHost = {
          React,
          registerPages: (pages) => {
            void attachIcons(pages, ext).finally(() => registerExtensionPages(pages))
          },
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
