import { services, type AppPlugin, type Desktop, type Theme, type ThemePreference, type ThemeState } from '@sisyphus/sdk'
import './theme.css'

export const themePlugin: AppPlugin = {
  id: 'ui.theme', name: 'Appearance', inject: [services.desktop], provide: [services.theme],
  apply(ctx) {
    const desktop = ctx.get(services.desktop) as Desktop
    const media = matchMedia('(prefers-color-scheme: dark)')
    const cached = localStorage.getItem('sisyphus.theme')
    let state: ThemeState = { theme: cached === 'light' || cached === 'dark' ? cached : 'system', dark: false }
    const listeners = new Set<() => void>()
    let alive = true
    const apply = (next: ThemeState & { platform?: string }) => {
      if (!alive) return
      state = { theme: next.theme, dark: next.dark }
      document.documentElement.dataset.theme = next.dark ? 'dark' : 'light'
      if (next.platform) document.documentElement.dataset.platform = next.platform
      localStorage.setItem('sisyphus.theme', next.theme)
      for (const listener of listeners) listener()
    }
    const resolve = (theme: ThemePreference) => ({ theme, dark: theme === 'dark' || (theme === 'system' && media.matches) })
    apply(resolve(state.theme))
    const systemChanged = () => { if (state.theme === 'system') apply(resolve('system')) }
    media.addEventListener('change', systemChanged)
    const off = desktop.on<ThemeState & { platform: string }>('appearance.changed', apply)
    void desktop.call<ThemeState & { platform: string }>('appearance.get').then(apply).catch(() => {})
    const theme: Theme = {
      getSnapshot: () => state,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      async set(preference) {
        if (window.sisyphus) apply(await desktop.call<ThemeState>('appearance.set', { theme: preference }))
        else apply(resolve(preference))
      },
    }
    ctx.provide(services.theme, theme)
    ctx.effect(() => () => { alive = false; off(); media.removeEventListener('change', systemChanged); listeners.clear() })
  },
}
