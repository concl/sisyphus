import { useState, useSyncExternalStore } from 'react'
import { readable, type Theme, type ThemePreference } from '@sisyphus/sdk'

export function AppearanceSettings({ theme }: { theme: Theme }) {
  const appearance = useSyncExternalStore(theme.subscribe, theme.getSnapshot)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  async function select(value: ThemePreference) {
    setSaving(true)
    setError('')
    try {
      await theme.set(value)
    } catch (error) {
      setError(readable(error))
    } finally {
      setSaving(false)
    }
  }
  return (
    <>
      <label>Theme</label>
      <div className="theme-options" role="group" aria-label="Theme">
        {(['system', 'light', 'dark'] as const).map((value) => (
          <button
            key={value}
            aria-pressed={appearance.theme === value}
            disabled={saving}
            onClick={() => void select(value)}
          >
            <span className={`theme-preview ${value}`} aria-hidden="true" />
            <strong>{value === 'system' ? 'System' : value === 'light' ? 'Light' : 'Dark'}</strong>
          </button>
        ))}
      </div>
      <p className="settings-hint">
        System follows your operating system’s theme. Changes apply immediately.
      </p>
      {error && <p role="alert">{error}</p>}
    </>
  )
}
