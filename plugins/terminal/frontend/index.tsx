import { services, type AppPlugin, type Desktop, type Panels } from '@sisyphus/sdk'
import { terminalSessionFactory } from './session'
import { createTerminalStore } from './store'
import { TerminalPanel } from './terminal-panel'
import '@xterm/xterm/css/xterm.css'
import './terminal.css'
import icon from './icon.svg'

export const terminalPlugin: AppPlugin = {
  id: 'feature.terminal',
  name: 'Terminal',
  inject: [services.panels, services.desktop],
  apply(ctx) {
    const desktop = ctx.get(services.desktop) as Desktop
    const panels = ctx.get(services.panels) as Panels
    const store = createTerminalStore(desktop, terminalSessionFactory(desktop))
    ctx.effect(() => () => store.dispose())
    ctx.effect(() =>
      panels.register({
        id: 'terminal',
        title: 'Terminal',
        icon,
        description: 'Shell sessions with vertical tabs.',
        component: () => <TerminalPanel store={store} />,
      }),
    )
  },
}
