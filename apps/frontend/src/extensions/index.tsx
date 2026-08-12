import { homeExtension } from '@sisyphus/extension-home'
import { terminalExtension } from '@sisyphus/extension-terminal'
import { processesExtension } from '@sisyphus/extension-processes'
import { apiExtension } from '@sisyphus/extension-api'

/**
 * The page registry — the single place extensions declare sidebar pages.
 * Each entry is an extension package under packages/; adding a page means
 * adding its descriptor here (a future runtime loader would push descriptors
 * into this list instead).
 */
export const pages = [
  homeExtension,
  terminalExtension,
  processesExtension,
  apiExtension,
] as const
