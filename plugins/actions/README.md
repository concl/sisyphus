# Action catalog

This plugin provides `actions.v1` in the backend and `ui.actions.v1` in the
renderer. Both are independent of the automation panel and workflow engine.
Components keep their own domain services; an adapter registers selected methods
as discoverable actions through a disposable Cordis effect.

```js
ctx.effect(() =>
  ctx.get('actions.v1').registerService('example', {
    name: 'Example',
    actions: {
      lookup: {
        name: 'Look up an item',
        defaults: { name: '' },
        fields: [{ key: 'name', label: 'Name', kind: 'text', expose: true }],
        outputs: [{ key: 'item', label: 'Item', kind: 'json' }],
        validate(input) {
          if (!input.name) throw new Error('Enter a name')
        },
        execute: async (input, { signal }) => ({
          item: await service.lookup(input.name, { signal }),
        }),
      },
    },
  }),
)
```

Call `actions.invoke('example.lookup', input, { signal, log })` from other
components. Inputs and outputs are JSON data; functions remain in the provider.
Unregistering removes aliases and cancels owned calls, even when an implementation
ignores cancellation. Providers must still observe the signal to stop ongoing
work. Reloading registers a fresh lifetime.

`expose: true` makes an action field a card input when added in the graph editor.
An optional field `editor` names a provider-owned input presentation. The action
descriptor's optional `presentation` names a result presentation. In a renderer
adapter, inject `ui.actions.v1` and register either or both:

```tsx
ctx.effect(() =>
  presentations.register('example.item', {
    input: ({ value, change, disabled }) => (
      <ItemPicker value={value} onChange={change} disabled={disabled} />
    ),
    summary: ({ value }) => <ItemLabel item={value} />,
    result: ({ value }) => <ItemSummary item={value} />,
  }),
)
```

The UI observes these registrations and disposes them with their components.
Structured card inputs use `summary` for a compact preview and open `input` in a
modal dialog. The selected step always keeps its settings editable in place.
Missing custom editors fall back to the field's generic control. Calendar's
adapter demonstrates reusable scheduling controls, an observable domain change,
and a result that can open the existing Calendar panel. The catalog publishes
`actions.changed` and exposes `actions.list` over the desktop transport.
