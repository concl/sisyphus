import type { ComponentType } from 'react'

/** Props every registered page receives. */
export interface PageProps {
  active: boolean
}

/**
 * Renderer-side page descriptor. The extension owns its icon: `icon` is
 * inline SVG markup, not a reference to an app-level sprite.
 */
export interface ExtensionManifest {
  id: string
  title: string
  /** Inline SVG markup for the sidebar icon (e.g. an icon.svg imported `?raw`). */
  icon?: string
  /** Keep mounted while inactive so state survives page switches. */
  keepAlive: boolean
}

/** A sidebar-visible page contributed by an extension. */
export interface ExtensionPage extends ExtensionManifest {
  component: ComponentType<PageProps>
}

/**
 * A page declared in a runtime extension's manifest.json. `icon` is a file
 * name within the extension directory (e.g. "icon.svg"); the host resolves
 * it to a URL and inlines the SVG markup into the registered page.
 */
export interface RuntimePageManifest {
  id: string
  title: string
  icon?: string
  keepAlive: boolean
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
  pages: RuntimePageManifest[]
}

/** A page of an installed runtime extension, as listed over IPC. */
export interface ListedPage {
  id: string
  /** URL of the page's icon file (served over `sisyphus-ext://`), when declared. */
  iconUrl?: string
}

/** An installed runtime extension as listed over IPC. */
export interface ListedExtension {
  id: string
  version: string
  /** URL of the entry module, served by the main process over `sisyphus-ext://`. */
  url: string
  /** URL of the optional stylesheet. */
  styleUrl?: string
  /** Pages declared in the manifest, with icon URLs resolved by the main process. */
  pages: ListedPage[]
}
