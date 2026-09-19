import { useSyncExternalStore } from 'react'
import { services, type AppPlugin, type Panels } from '@sisyphus/sdk'
import icon from './icon.svg'

export const homePlugin: AppPlugin = {
  id: 'feature.home',
  name: 'Home',
  inject: [services.panels],
  apply(ctx) {
    const panels = ctx.get(services.panels) as Panels
    function Home() {
      const available = useSyncExternalStore(panels.subscribe, panels.list)
      return (
        <article className="home-panel">
          <div className="eyebrow">YOUR PERSONAL WORKSPACE</div>
          <h1>
            A place to make
            <br />
            <em>things happen.</em>
          </h1>
          <p className="home-intro">
            Start with a few useful pieces.
            <br />
            Make room for whatever comes next.
          </p>
          <div className="section-label">
            OPEN A BLOCK <span>{String(available.length - 1).padStart(2, '0')}</span>
          </div>
          <div className="launch-grid">
            {available
              .filter((panel) => panel.id !== 'home')
              .map((panel) => (
                <button
                  className="launch-card"
                  key={panel.id}
                  onClick={() => panels.open(panel.id)}
                  data-open={panel.id}
                >
                  <span className="launch-icon">
                    <img src={panel.icon} alt="" />
                  </span>
                  <strong>{panel.title}</strong>
                  <span>{panel.description}</span>
                  <b>↗</b>
                </button>
              ))}
          </div>
          <div className="home-note">
            <span className="note-symbol">⌘</span>
            <div>
              <strong>A workspace that moves with you</strong>
              <p>
                Drag a tab to an edge to split the space. Drop it beside another tab to stack.
                Resize between blocks to find your flow.
              </p>
            </div>
          </div>
          <footer className="home-footer">
            <span>BUILT TO BE REBUILT</span>
            <span>One piece at a time. ↗</span>
          </footer>
        </article>
      )
    }
    ctx.effect(() =>
      panels.register({
        id: 'home',
        title: 'Home',
        description: 'Your starting point',
        icon,
        component: Home,
      }),
    )
  },
}
