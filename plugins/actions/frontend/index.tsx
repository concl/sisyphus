import { services, type AppPlugin, type Desktop, type Panels } from '@sisyphus/sdk'
import { Actions } from './actions'
import icon from './icon.svg'
import type { ActionPresentations } from '@sisyphus/sdk'
import { SavedCardInput } from './saved-card-input'

export const actionsPlugin: AppPlugin = {
  id: 'feature.contexts',
  name: 'Actions',
  inject: [services.panels, services.desktop, 'ui.actions.v1'],
  apply(ctx) {
    const panels = ctx.get(services.panels) as Panels
    const desktop = ctx.get(services.desktop) as Desktop
    const presentations = ctx.get('ui.actions.v1') as ActionPresentations
    ctx.effect(() =>
      presentations.register('automation.card', {
        input: (props) => <SavedCardInput {...props} desktop={desktop} />,
      }),
    )
    ctx.effect(() =>
      panels.register({
        // Preserve the old panel id so saved dock layouts still restore.
        id: 'contexts',
        title: 'Actions',
        description: 'Saved actions and their inputs.',
        icon,
        component: () => <Actions desktop={desktop} presentations={presentations} />,
        priority: 80,
      }),
    )
  },
}
