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
        description: 'Find an item by its name.',
        effects: ['Reads items; does not change stored data.'],
        calls: ['example.service.v1.lookup(name)'],
        notes: ['Fails when no item matches.'],
        examples: [{ title: 'Find a report', input: { name: 'Report' } }],
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

## Action reference contract

The workflow library and inspector render the same reference directly from the
descriptor. Keep documentation next to the service adapter, so actions remain
discoverable without editor-specific code:

- `description`: what the action does, in one plain sentence.
- `fields`: input key, readable label, kind, `hint`, `required`, conditional `when`,
  choices and limits. `defaults` supplies initial values for direct and workflow calls.
- `outputs`: returned keys, kinds and hints, including nullable or conditional results.
- `effects`: persistent changes or external effects, including what Stop cannot undo.
  Say explicitly when there are no changes.
- `calls`: domain service calls and significant chained operations, as readable strings.
- `notes`: completion, failure, cancellation, and data-passing behavior.
- `examples`: `{ title, input, output? }` examples containing JSON data only.

`required` documents the contract; the provider's `validate` function remains
authoritative. Documentation is optional for third-party compatibility; missing
effect/call descriptions are identified as undocumented, never assumed harmless.
All metadata travels through `actions.list`; executable functions stay in the provider.

## Source ownership

This package owns the action catalog, the [editor](README.md),
`desktop.automations` (workflow execution and saved cards),
`desktop.local-actions`, `desktop.network-actions`, and `desktop.data-actions`.
Each entry retains its ID and can be toggled independently. Application
integration providers live in `plugins/integrations`.

Reusable process and editor-launch helpers are ordinary `@sisyphus/native`
imports. UI presentation contracts are type-only imports from `@sisyphus/sdk`.
