import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { Sidebar, type Page } from './components/Sidebar'
import { HomePage } from './components/HomePage'
import { TerminalPage } from './components/TerminalPage'
import styles from './App.module.css'

export default function App() {
  const [page, setPage] = useState<Page>('home')
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === '1')

  useEffect(() => {
    if (window.versions?.platform() === 'darwin') document.body.classList.add('darwin')
  }, [])

  const toggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('sidebarCollapsed', next ? '1' : '0')
      return next
    })
  }

  return (
    <div className={styles.app}>
      <header className={styles.titlebar}>
        <button
          type="button"
          className={`icon-btn ${styles.noDrag}`}
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
          onClick={toggleSidebar}
        >
          <Icon name="icon-menu" className="icon" />
        </button>
        <span className={styles.appTitle}>Sisyphus</span>
      </header>

      <div className={styles.layout}>
        <Sidebar page={page} onNavigate={setPage} collapsed={collapsed} />

        {/* Both pages stay mounted so terminals survive page switches. */}
        <main className={styles.content}>
          <div className={`${styles.page}${page === 'home' ? ` ${styles.active}` : ''}`}>
            <HomePage />
          </div>
          <div className={`${styles.page}${page === 'terminal' ? ` ${styles.active}` : ''}`}>
            <TerminalPage active={page === 'terminal'} />
          </div>
        </main>
      </div>
    </div>
  )
}
