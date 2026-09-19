import { services, type AppPlugin, type Desktop, type Storage } from '@sisyphus/sdk'

/**
 * The host's own plugins: the bridge to the native half, and local storage.
 *
 * Everything else in this app - every panel, the workspace frame, the chat, the
 * terminal - is a plugin file the window reads from disk while it starts, so it can
 * be edited, reloaded, added, or removed without a rebuild. `host.ts` loads them,
 * and `scripts/build-plugins.mjs` turns `packages/plugin-*` into the files the
 * distribution ships.
 *
 * These two are not files because they are not plugins in that sense: they are what
 * a plugin file talks to, and a window with no bridge to the native half has
 * nothing to load anything with.
 */
export function profile(): AppPlugin[] {
  return [
    {
      id: 'platform.desktop',
      name: 'Desktop bridge',
      provide: [services.desktop],
      apply(ctx) {
        // Browser development can render the workspace; native operations report unavailable.
        ctx.provide(
          services.desktop,
          window.sisyphus ?? {
            call: () => Promise.reject(new Error('Open the desktop app to use native services.')),
            on: () => () => {},
            dropFiles: () => Promise.reject(new Error('Open the desktop app to drop files.')),
          },
        )
      },
    },
    {
      id: 'platform.storage',
      name: 'Local storage',
      inject: [services.desktop],
      provide: [services.storage],
      apply(ctx) {
        const desktop = ctx.get(services.desktop) as Desktop
        const adapter: Storage = window.sisyphus
          ? {
              get: (scope, key) => desktop.call('storage.get', { scope, key }),
              set: (scope, key, value) => desktop.call('storage.set', { scope, key, value }),
            }
          : {
              get: async (scope, key) =>
                JSON.parse(localStorage.getItem(`${scope}:${key}`) ?? 'null') ?? undefined,
              set: async (scope, key, value) => {
                localStorage.setItem(`${scope}:${key}`, JSON.stringify(value))
              },
            }
        ctx.provide(services.storage, adapter)
      },
    },
  ]
}
