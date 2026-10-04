import type { AppPlugin } from '@sisyphus/sdk'
import { ActionPresentations } from './presentations'
export const actionCatalogPlugin: AppPlugin = {
  id: 'feature.action-catalog',
  name: 'Action presentations',
  provide: ['ui.actions.v1'],
  apply(ctx) {
    ctx.provide('ui.actions.v1', new ActionPresentations())
  },
}
