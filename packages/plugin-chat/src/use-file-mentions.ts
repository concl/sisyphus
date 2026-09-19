import { useCallback, useEffect, useRef } from 'react'
import type { Desktop, FileEntry } from '@sisyphus/sdk'

const LIMIT = 25

/**
 * Cached, folder-scoped file lookup behind the composer's @ mentions. Results
 * are keyed by query so typing back and forth does not re-walk the folder.
 */
export function useFileMentions(desktop: Desktop, folder: string | null) {
  const cache = useRef(new Map<string, FileEntry[]>())

  useEffect(() => {
    cache.current.clear()
  }, [folder])

  return useCallback(
    async (query: string): Promise<FileEntry[]> => {
      if (!folder) return []
      const key = query.trim().toLowerCase()
      const cached = cache.current.get(key)
      if (cached) return cached
      try {
        const entries = await desktop.call<FileEntry[]>('files.list', {
          folder,
          query,
          limit: LIMIT,
        })
        if (cache.current.size > 200) cache.current.clear()
        cache.current.set(key, entries)
        return entries
      } catch {
        return []
      }
    },
    [desktop, folder],
  )
}
