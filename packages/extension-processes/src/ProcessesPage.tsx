import { useCallback, useEffect, useState } from 'react'
import type { ManagedProcessInfo } from '@sisyphus/shared'
import styles from './ProcessesPage.module.css'

/**
 * Concept extension: a live view of the subprocesses the main process
 * manages — the python-host service and the terminal shells.
 */
export function ProcessesPage() {
  const [processes, setProcesses] = useState<ManagedProcessInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    if (!window.processes) return
    window.processes
      .list()
      .then(setProcesses)
      .catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    refresh()
    const iv = setInterval(refresh, 2000)
    return () => clearInterval(iv)
  }, [refresh])

  if (!window.processes) {
    return (
      <div className={styles.page}>
        <h1>Processes</h1>
        <p className={styles.dim}>Available only when running inside the Electron app.</p>
      </div>
    )
  }

  return (
    <div className={styles.page} data-testid="processes-page">
      <h1>Processes</h1>
      <p className={styles.hint}>
        Subprocesses managed by the app: the python-host service and the terminal
        shells. Refreshes automatically.
      </p>
      {error ? <p className={styles.error}>{error}</p> : null}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Status</th>
            <th>Kind</th>
            <th>Name</th>
            <th>PID</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {(processes ?? []).map((p) => (
            <tr key={p.id} data-testid="process-row">
              <td>
                <span className={`${styles.dot} ${p.running ? styles.running : styles.stopped}`} />
                {p.running ? 'running' : 'stopped'}
              </td>
              <td>
                <span className={`${styles.kind} ${p.kind === 'service' ? styles.service : styles.terminal}`}>
                  {p.kind}
                </span>
              </td>
              <td>{p.name}</td>
              <td className={styles.mono}>{p.pid ?? '—'}</td>
              <td className={styles.mono}>{JSON.stringify(p.detail ?? {})}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
