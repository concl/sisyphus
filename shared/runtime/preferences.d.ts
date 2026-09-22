import type { Profile } from './index.js'
/** A storage adapter: the native service answers synchronously, the renderer's does not. */
export interface KeyValueStore {
  get<T = unknown>(scope: string, key: string): Promise<T | undefined> | T | undefined
  set(scope: string, key: string, value: unknown): Promise<void> | void
}
export const PLUGIN_STATES_SCOPE: string
export const PLUGIN_STATES_KEY: string
export function readStates(storage: KeyValueStore): Promise<Record<string, boolean>>
export function writeState(
  storage: KeyValueStore,
  id: string,
  enabled: boolean,
): Promise<Record<string, boolean>>
export function applyStates(profile: Profile, storage: KeyValueStore): Promise<string[]>
