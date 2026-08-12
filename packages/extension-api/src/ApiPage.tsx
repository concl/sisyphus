import { useCallback, useEffect, useState } from 'react'
import type { ServiceCallResult, ServiceStatus } from '@sisyphus/shared'
import styles from './ApiPage.module.css'

/**
 * Concept extension: a frontend for the python-host FastAPI service. The page
 * reaches the service through window.services, which the main process proxies
 * to the service's HTTP API (renderer → IPC → main → HTTP).
 */
export function ApiPage() {
  const [status, setStatus] = useState<ServiceStatus | null>(null)
  const [info, setInfo] = useState<ServiceCallResult | null>(null)

  const refresh = useCallback(() => {
    if (!window.services) return
    window.services.status().then(setStatus)
    window.services.call('/api/info').then(setInfo)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (!window.services) {
    return (
      <div className={styles.page}>
        <h1>Python API</h1>
        <p className={styles.dim}>Available only when running inside the Electron app.</p>
      </div>
    )
  }

  return (
    <div className={styles.page} data-testid="api-page">
      <h1>Python API</h1>
      <p className={styles.hint}>
        This extension page talks to the python-host FastAPI service through the
        app's IPC bridge.
      </p>

      <section className={styles.card}>
        <h2>Service status</h2>
        {status ? (
          <dl className={styles.grid}>
            <dt>Running</dt>
            <dd>{status.running ? 'yes' : 'no'}</dd>
            <dt>Healthy</dt>
            <dd>{status.healthy ? 'yes' : 'no'}</dd>
            <dt>PID</dt>
            <dd className={styles.mono}>{status.pid ?? '—'}</dd>
            <dt>URL</dt>
            <dd className={styles.mono}>{status.url}</dd>
            {status.error ? (
              <>
                <dt>Error</dt>
                <dd className={styles.error}>{status.error}</dd>
              </>
            ) : null}
          </dl>
        ) : (
          <p className={styles.dim}>Loading…</p>
        )}
      </section>

      <section className={styles.card}>
        <h2>GET /api/info</h2>
        {info ? (
          info.ok ? (
            <pre className={styles.json} data-testid="api-info">
              {JSON.stringify(info.body, null, 2)}
            </pre>
          ) : (
            <p className={styles.error}>{info.error ?? `HTTP ${info.status}`}</p>
          )
        ) : (
          <p className={styles.dim}>Loading…</p>
        )}
      </section>

      <button type="button" className={styles.refresh} onClick={refresh}>
        Refresh
      </button>
    </div>
  )
}
