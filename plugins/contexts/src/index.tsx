import { services, type AppPlugin, type Desktop, type Panels } from '@sisyphus/sdk'
import { Launcher } from './launcher'
import editorIcon from './editor.svg'
import browserIcon from './browser.svg'

export const contextsPlugin: AppPlugin = {
  id: 'feature.contexts',
  name: 'App launchers',
  inject: [services.panels, services.desktop],
  apply(ctx) {
    const panels = ctx.get(services.panels) as Panels
    const desktop = ctx.get(services.desktop) as Desktop
    ctx.effect(() =>
      panels.register({
        // Preserve the old panel id so saved dock layouts still restore.
        id: 'contexts',
        title: 'VS Code',
        description: 'Open your saved editor workspaces.',
        icon: editorIcon,
        component: () => <Launcher desktop={desktop} integration="vscode" />,
        priority: 80,
      }),
    )
    ctx.effect(() =>
      panels.register({
        id: 'browser-tabs',
        title: 'Browser Tabs',
        description: 'Open a saved set of pages.',
        icon: browserIcon,
        component: () => <Launcher desktop={desktop} integration="browser" />,
        priority: 79,
      }),
    )
  },
}
