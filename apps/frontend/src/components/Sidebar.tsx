import { Icon } from '../icons'
import styles from './Sidebar.module.css'

export type Page = 'home' | 'terminal'

interface SidebarProps {
  page: Page
  onNavigate: (page: Page) => void
  collapsed: boolean
}

export function Sidebar({ page, onNavigate, collapsed }: SidebarProps) {
  return (
    <nav
      className={`${styles.sidebar}${collapsed ? ` ${styles.collapsed}` : ''}`}
      aria-label="Main navigation"
    >
      <div className={styles.items}>
        <button
          type="button"
          className={`${styles.item}${page === 'home' ? ` ${styles.active}` : ''}`}
          data-page="home"
          title="Home"
          onClick={() => onNavigate('home')}
        >
          <Icon name="icon-home" className="icon" />
          <span className={styles.label}>Home</span>
        </button>
        <button
          type="button"
          className={`${styles.item}${page === 'terminal' ? ` ${styles.active}` : ''}`}
          data-page="terminal"
          title="Terminal"
          onClick={() => onNavigate('terminal')}
        >
          <Icon name="icon-terminal" className="icon" />
          <span className={styles.label}>Terminal</span>
        </button>
      </div>
      <div className={styles.footer}>
        <span className={styles.label}>v1.0.0</span>
      </div>
    </nav>
  )
}
