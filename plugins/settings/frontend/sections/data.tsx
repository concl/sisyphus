import { useEffect, useState } from 'react'
import { readable, type Desktop } from '@sisyphus/sdk'

interface Location {
  id: string
  title: string
  description: string
  path: string
  exists: boolean
  directory?: boolean
}

export function DataSettings({ desktop }: { desktop: Desktop }) {
  const [locations, setLocations] = useState<Location[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    void desktop
      .call<Location[]>('data.locations')
      .then((result) => {
        if (alive) {
          setLocations(result)
          setError('')
        }
      })
      .catch((error) => {
        if (alive) setError(readable(error))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [desktop, attempt])
  async function reveal(id: string) {
    setError('')
    try {
      await desktop.call('data.open', { id })
    } catch (error) {
      setError(readable(error))
    }
  }
  return (
    <>
      <button onClick={() => void reveal('all')}>Open app data folder</button>
      {loading && <p role="status">Loading locations…</p>}
      {error && (
        <div>
          <p role="alert">{error}</p>
          <button
            onClick={() => {
              setLoading(true)
              setAttempt((value) => value + 1)
            }}
          >
            Retry
          </button>
        </div>
      )}
      <div className="data-locations">
        {locations
          .filter((location) => location.id !== 'all')
          .map((location) => (
            <article key={location.id}>
              <div>
                <strong>{location.title}</strong>
                <p>{location.description}</p>
                <code>{location.path}</code>
                {!location.exists && <small>Created when first used</small>}
              </div>
              <button onClick={() => void reveal(location.id)}>
                {location.exists && !location.directory ? 'Reveal file' : 'Open folder'}
              </button>
            </article>
          ))}
      </div>
    </>
  )
}
