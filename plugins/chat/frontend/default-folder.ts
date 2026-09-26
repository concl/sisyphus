const KEY = 'sisyphus.chat.defaultFolder.v1'

/**
 * The folder the next new conversation starts in, remembered per window.
 *
 * This is a preference, not conversation data: nothing is written to a
 * conversation file until its first message is sent, so choosing a new default
 * never touches the conversations that are already stored.
 */
export function readDefaultFolder(): string | null {
  try {
    const value = localStorage.getItem(KEY)
    return value && value.trim() ? value : null
  } catch {
    // Storage can be unavailable; the default simply starts out unchosen.
    return null
  }
}

export function writeDefaultFolder(folder: string | null) {
  try {
    if (folder) localStorage.setItem(KEY, folder)
    else localStorage.removeItem(KEY)
  } catch {
    // Storage can be unavailable; the choice still holds for this session.
  }
}
