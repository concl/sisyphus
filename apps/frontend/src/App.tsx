import { useEffect, useSyncExternalStore, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { getPages, subscribePages } from './extensions/registry'
import styles from './App.module.css'

export default function App() {
  const [page, setPage] = useState('home')
  // The page list starts as the compile-time pages; runtime extensions append
  // to it via the registry store (see extensions/loader.ts).
  const pages = useSyncExternalStore(subscribePages, getPages)

  useEffect(() => {
    if (window.versions?.platform() === 'darwin') document.body.classList.add('darwin')
  }, [])

  return (
    <div className={styles.app}>
      <header className={styles.titlebar}>
        <span className={styles.appTitle}>Sisyphus</span>
      </header>

      <div className={styles.layout}>
        <Sidebar page={page} onNavigate={setPage} pages={pages} />

        {/* keepAlive pages stay mounted while inactive so their state (e.g.
            terminals) survives switches; other pages mount on activation. */}
        <main className={styles.content}>
          {pages.map((p) => {
            const isActive = page === p.id
            if (!isActive && !p.keepAlive) return null
            return (
              <div key={p.id} className={`${styles.page}${isActive ? ` ${styles.active}` : ''}`}>
                <p.component active={isActive} />
              </div>
            )
          })}
        </main>
      </div>
    </div>
  )
}
