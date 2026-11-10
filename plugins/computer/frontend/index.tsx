import { services, type AppPlugin, type Desktop, type Settings } from '@sisyphus/sdk'
import { useEffect, useState } from 'react'

interface DesktopSettings {
  enabled: boolean
  host: string
  hasToken: boolean
}

function ComputerSettings({ desktop }: { desktop: Desktop }) {
  const [saved, setSaved] = useState<DesktopSettings>()
  const [enabled, setEnabled] = useState(false)
  const [host, setHost] = useState('')
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void desktop.call<DesktopSettings>('computer.settings.get').then(
      (settings) => {
        if (!active) return
        setSaved(settings)
        setEnabled(settings.enabled)
        setHost(settings.host)
      },
      (problem) => {
        if (active) setError(String(problem))
      },
    )
    return () => {
      active = false
    }
  }, [desktop])

  async function save() {
    setSaving(true)
    setError('')
    try {
      const settings = await desktop.call<DesktopSettings>('computer.settings.save', {
        enabled,
        host,
        token,
      })
      setSaved(settings)
      setHost(settings.host)
      setToken('')
    } catch (problem) {
      setError(String(problem).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''))
    } finally {
      setSaving(false)
    }
  }

  if (!saved)
    return error ? <p role="alert">{error}</p> : <p role="status">Loading computer settings…</p>
  const dirty = enabled !== saved.enabled || host !== saved.host || Boolean(token)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <fieldset className="settings-fields" disabled={saving}>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Use an isolated desktop
        </label>
        <p className="settings-hint">
          Send screenshots and input through a Windows VM. Set up SSH and start the Sisyphus desktop
          helper in the signed-in VM first.
        </p>
        <label>
          VM SSH host
          <input
            value={host}
            onChange={(event) => setHost(event.target.value)}
            spellCheck={false}
          />
        </label>
        <label>
          Pairing token
          <input
            type="password"
            autoComplete="new-password"
            placeholder={saved.hasToken ? 'Token saved' : undefined}
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        <div className="settings-actions">
          <span role="status">
            {saved.enabled ? 'Desktop target: Windows VM' : 'Desktop target: This computer'}
          </span>
          <button type="submit" disabled={!dirty}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}

export const computerSettingsPlugin: AppPlugin = {
  id: 'feature.computer-settings',
  name: 'Computer use settings',
  inject: [services.settings, services.desktop],
  apply(ctx) {
    const settings = ctx.get(services.settings) as Settings
    const desktop = ctx.get(services.desktop) as Desktop
    ctx.effect(() =>
      settings.register({
        id: 'chat.computer',
        category: 'Chat',
        title: 'Computer use',
        order: 13.5,
        description: 'Choose where screenshots and desktop input are sent.',
        keywords: [
          'isolated desktop',
          'virtual machine',
          'vm',
          'ssh',
          'screen',
          'keyboard',
          'mouse',
        ],
        component: () => <ComputerSettings desktop={desktop} />,
      }),
    )
  },
}
