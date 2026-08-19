import { homeExtension } from '@sisyphus/extension-home'
import { terminalExtension } from '@sisyphus/extension-terminal'
import { processesExtension } from '@sisyphus/extension-processes'
import { apiExtension } from '@sisyphus/extension-api'

/**
 * The compile-time page registry — the pages that ship in the bundle.
 * Each entry is an extension package under packages/; adding a page means
 * adding its descriptor here. Runtime extensions (loaded from the userData
 * store at startup) append to the live registry instead — see registry.ts
 * and loader.ts.
 */
export const pages = [
  homeExtension,
  terminalExtension,
  processesExtension,
  apiExtension,
] as const
