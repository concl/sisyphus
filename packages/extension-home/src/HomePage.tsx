import { useState } from 'react'
import { Icon } from '@sisyphus/shared'
import icon from './icon.svg?raw'
import styles from './HomePage.module.css'

export function HomePage() {
  // window.versions is injected by preload.js before React renders, so it can
  // be read synchronously once.
  const [versions] = useState(() =>
    window.versions
      ? {
          node: window.versions.node(),
          chrome: window.versions.chrome(),
          electron: window.versions.electron(),
        }
      : null,
  )

  return (
    <div className={styles.hero}>
      <Icon svg={icon} className={styles.logo} />
      <h1>Hello, World!</h1>
      <p>
        Welcome to <strong>Sisyphus</strong>. Head over to the Terminal page to open a
        shell on this machine.
      </p>
      {window.versions ? (
        <div className={styles.cards}>
          <div>
            Electron<span>{versions?.electron ?? '–'}</span>
          </div>
          <div>
            Chromium<span>{versions?.chrome ?? '–'}</span>
          </div>
          <div>
            Node<span>{versions?.node ?? '–'}</span>
          </div>
        </div>
      ) : (
        <p className={styles.note}>Running in a browser — launch the Electron app for the full experience.</p>
      )}
    </div>
  )
}
