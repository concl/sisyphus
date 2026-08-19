import { Icon } from '@sisyphus/shared'
import type { ExtensionPage } from '@sisyphus/shared'
import styles from './Sidebar.module.css'

interface SidebarProps {
  page: string
  onNavigate: (page: string) => void
  pages: readonly ExtensionPage[]
}

export function Sidebar({ page, onNavigate, pages }: SidebarProps) {
  return (
    <nav className={styles.sidebar} aria-label="Main navigation">
      <div className={styles.items}>
        {pages.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`${styles.item}${page === p.id ? ` ${styles.active}` : ''}`}
            data-page={p.id}
            title={p.title}
            onClick={() => onNavigate(p.id)}
          >
            {p.icon ? (
              <Icon svg={p.icon} className="icon" />
            ) : (
              <span className={`${styles.fallback} icon`} aria-hidden="true">
                {p.title.charAt(0)}
              </span>
            )}
            <span className={styles.label}>{p.title}</span>
          </button>
        ))}
      </div>
      <div className={styles.footer}>
        <span className={styles.label}>v1.0.0</span>
      </div>
    </nav>
  )
}
