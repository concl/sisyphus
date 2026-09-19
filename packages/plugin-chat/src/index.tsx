import { services, type AppPlugin, type Desktop, type Panels } from '@sisyphus/sdk'
import icon from './icon.svg'
import { ChatPanel } from './chat-panel'

export const chatPlugin: AppPlugin = {
  id: 'feature.chat',
  name: 'Chat',
  inject: [services.panels, services.desktop],
  apply(ctx) {
    const panels = ctx.get(services.panels) as Panels
    const desktop = ctx.get(services.desktop) as Desktop
    ctx.effect(() =>
      panels.register({
        id: 'chat',
        title: 'Chat',
        description: 'Your model, connected to your workspace.',
        icon,
        component: () => <ChatPanel panels={panels} desktop={desktop} />,
      }),
    )
  },
}
