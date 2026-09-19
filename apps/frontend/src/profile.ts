import type { Profile } from '@sisyphus/profile'
import { services, type AppPlugin, type Desktop, type Storage } from '@sisyphus/sdk'
import { panelsPlugin } from '@sisyphus/plugin-panels'
import { homePlugin } from '@sisyphus/plugin-home'
import { terminalPlugin } from '@sisyphus/plugin-terminal'
import { pythonPlugin } from '@sisyphus/plugin-python'
import { plannerPlugin } from '@sisyphus/plugin-planner'
import { workspacePlugin } from '@sisyphus/plugin-workspace'
import { themePlugin } from '@sisyphus/plugin-theme'
import { settingsPlugin } from '@sisyphus/plugin-settings'
import { chatPlugin } from '@sisyphus/plugin-chat'

export function profile(runtime: Profile): AppPlugin[] {
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
    panelsPlugin,
    themePlugin,
    settingsPlugin,
    chatPlugin,
    homePlugin,
    terminalPlugin,
    pythonPlugin,
    plannerPlugin,
    workspacePlugin(runtime, [
      { id: 'home' },
      { id: 'python-host', direction: 'right', reference: 'home', width: 420 },
      { id: 'terminal', direction: 'below', reference: 'home', height: 235 },
      { id: 'planner', direction: 'below', reference: 'python-host', height: 415 },
    ]),
  ]
}
