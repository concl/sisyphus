import { services, type AppPlugin, type Panels, type PlannerItem } from '@sisyphus/sdk'
import type { ActionPresentations } from '../../actions/frontend/presentations'
import { EventInput } from './action-event-input'
export const plannerActionsPlugin: AppPlugin = {
  id: 'feature.planner-actions',
  name: 'Calendar actions',
  inject: ['ui.actions.v1', services.panels, services.planner],
  apply(ctx) {
    const presentations = ctx.get('ui.actions.v1') as ActionPresentations
    const panels = ctx.get(services.panels) as Panels
    ctx.effect(() =>
      presentations.register('planner.event', {
        input: EventInput,
        summary: ({ value }) => {
          const event = (value && typeof value === 'object' ? value : {}) as Partial<PlannerItem>
          return (
            <span className="action-event-summary">
              <strong>{event.title || 'Untitled event'}</strong>
              <small>
                {event.date
                  ? new Date(`${event.date}T12:00:00`).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })
                  : 'Choose a date'}
                {event.start
                  ? ` · ${new Date(event.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : ' · All day'}
              </small>
            </span>
          )
        },
      }),
    )
    ctx.effect(() =>
      presentations.register('planner.item', {
        result: ({ value }) => {
          const event = value as PlannerItem
          return (
            <div className="action-event-result">
              <p>
                <strong>{event.title}</strong>
                <br />
                {event.date}
                {event.start
                  ? ` · ${new Date(event.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : ' · All day'}
              </p>
              <button onClick={() => panels.open('calendar')}>Show in Calendar</button>
            </div>
          )
        },
      }),
    )
  },
}
