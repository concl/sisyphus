// Runtime extension demo. Loaded at runtime from the extension store
// (userData/extensions/runtime-sample@1.1.0/) over the sisyphus-ext://
// protocol. The host SDK — passed as the `host` argument — provides React,
// the page-registration function, and scoped key-value storage; no imports,
// no build step. The page's icon is owned by this extension: it is declared
// in manifest.json ("icon": "icon.svg") and the host resolves and injects it.
export function register({ React, registerPages, storage }) {
  const SamplePage = () => {
    // Persist a visit counter through the host's storage API (scoped to this
    // extension's id under userData/storage/).
    const [visits, setVisits] = React.useState(null)
    React.useEffect(() => {
      storage.get('visits').then((n) => {
        const next = (typeof n === 'number' ? n : 0) + 1
        setVisits(next)
        storage.set('visits', next)
      })
    }, [])

    return React.createElement(
      'div',
      { className: 'runtime-sample', 'data-testid': 'runtime-sample' },
      React.createElement('h1', null, 'Runtime Sample'),
      React.createElement(
        'p',
        null,
        'This page was loaded at runtime from the extension store, not bundled with the app.',
      ),
      React.createElement(
        'p',
        { className: 'runtime-sample-meta' },
        `runtime-sample@1.1.0 · visits: ${visits ?? '…'} · store: userData/extensions`,
      ),
    )
  }

  registerPages([
    { id: 'runtime-sample', title: 'Runtime Sample', keepAlive: false, component: SamplePage },
  ])
}
