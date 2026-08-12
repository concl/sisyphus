import type { ComponentType } from 'react'

/** Props every registered page receives. */
export interface PageProps {
  active: boolean
}

/**
 * Framework-agnostic page descriptor — the data that would come from an
 * extension manifest. `ExtensionPage` adds the renderer-side component.
 */
export interface ExtensionManifest {
  id: string
  title: string
  /** Sprite symbol id (see the frontend's assets/icons.svg). */
  icon: string
  /** Keep mounted while inactive so state survives page switches. */
  keepAlive: boolean
}

/** A sidebar-visible page contributed by an extension. */
export interface ExtensionPage extends ExtensionManifest {
  component: ComponentType<PageProps>
}

/**
 * The on-disk manifest of a runtime extension, stored under
 * `userData/extensions/<id>@<version>/` (see ARCHITECTURE.md).
 */
export interface RuntimeExtensionManifest {
  id: string
  version: string
  /** Entry module (ESM) that exports `register(host)`. */
  entry: string
  /** Optional stylesheet, injected by the host when present. */
  style?: string
  pages: ExtensionManifest[]
}

/** An installed runtime extension as listed over IPC. */
export interface ListedExtension {
  id: string
  version: string
  /** URL of the entry module, served by the main process over `sisyphus-ext://`. */
  url: string
  /** URL of the optional stylesheet. */
  styleUrl?: string
}
