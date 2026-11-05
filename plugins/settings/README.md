# Settings

`frontend/index.tsx` provides `services.settings` and registers the Settings panel.
`registry.ts` owns section registration, ordering, subscriptions, and search.
`settings-panel.tsx` owns navigation and search results. `builtins.tsx` lists the
built-in sections; their components live in `sections/`. `chat-store.ts` owns
shared Chat drafts, loading, saving, and errors independently of navigation.

## Add a section from another plugin

Import `Settings` and `SettingsSection` from `@sisyphus/sdk`. Inject
`services.settings` and register a component in an effect:

```tsx
import { services, type AppPlugin, type Settings } from '@sisyphus/sdk'

export const examplePlugin: AppPlugin = {
  id: 'example.preferences',
  inject: [services.settings],
  apply(ctx) {
    const settings = ctx.get(services.settings) as Settings
    ctx.effect(() =>
      settings.register({
        id: 'example.display',
        category: 'Example',
        title: 'Display',
        description: 'Font and text size.',
        keywords: ['font family', 'font size', 'zoom'],
        component: DisplaySettings,
      }),
    )
  },
}
```

The contributing plugin supplies `DisplaySettings` and owns its loading,
validation, persistence, and error messages. Use a stable namespaced ID. Lower
`order` values come first (default 100); ties sort by category and title.
Categories follow their first section's position. Sections are removed when
their owner is disabled, reloaded, or disposed. Search matches every word in a
query against the title, category, description, and keywords, ignoring case.
Include field labels and synonyms in keywords. Contributions appear in both
navigation and search without changing the Settings plugin. Render errors are
contained within the selected section.

Chat changes and provider JSON have separate save actions. Drafts survive
section navigation and panel remounts within the same plugin instance. They are
not persisted until saved; a window refresh or plugin reload discards drafts.
Reload from file is disabled while provider edits are unsaved; save or discard
them first. Appearance changes apply immediately. Failed requests show a local
error and can be retried without blocking unrelated settings.
