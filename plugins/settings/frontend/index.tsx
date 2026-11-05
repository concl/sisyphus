import { services, type AppPlugin, type Desktop, type Panels, type Theme } from '@sisyphus/sdk'
import { builtinSections } from './builtins'
import { createChatSettings } from './chat-store'
import { createSettings } from './registry'
import { SettingsPanel } from './settings-panel'
import icon from './icon.svg'
import './settings.css'

export const settingsPlugin: AppPlugin = {
  id: 'feature.settings',
  name: 'Settings',
  inject: [services.panels, services.desktop, services.theme],
  provide: [services.settings],
  apply(ctx) {
    const panels = ctx.get(services.panels) as Panels
    const desktop = ctx.get(services.desktop) as Desktop
    const theme = ctx.get(services.theme) as Theme
    const settings = createSettings()
    const chat = createChatSettings(desktop)
    for (const section of builtinSections(desktop, theme, chat)) settings.register(section)
    ctx.provide(services.settings, settings)
    ctx.effect(() =>
      panels.register({
        id: 'settings',
        title: 'Settings',
        description: 'App preferences.',
        icon,
        priority: 100,
        component: () => <SettingsPanel settings={settings} chat={chat} />,
      }),
    )
  },
}
