/**
 * The workspace arrangement: the order the block icons sit in the rail, and the
 * document a saved layout holds.
 *
 * The rail's order belongs to the registry until the person arranges it. That order
 * is also how a plugin asks for a place - Settings registers with a high priority, so
 * it leads the rail - and an arrangement the person made is kept as a list of panel
 * ids and is the order they see from then on. It is the same split as the dock
 * layout: the plugins say what exists, and the person says where it goes.
 */

export interface SavedLayout<T = unknown> {
  layout: T
  /**
   * The rail order that was in place when this layout was saved. Absent in a layout
   * saved before the rail could be arranged, which leaves the rail as it is.
   */
  rail?: string[]
}

/** What a saved layout holds: the dock arrangement, and the rail order beside it. */
export interface OpenableLayout<T> {
  layout: T
  rail: string[] | null
}

/** The panel ids a stored value holds, ignoring anything that is not a panel id. */
export function readRailOrder(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

/**
 * The rail: the blocks the person arranged, in the order they arranged them, then
 * the rest in the registry's order. A block that is not on the rail right now - it is
 * switched off, or nothing contributes it - is skipped, and its place is kept.
 */
export function orderedPanels<T extends { id: string }>(
  panels: readonly T[],
  arrangement: readonly string[],
): T[] {
  const known = new Map(panels.map((panel) => [panel.id, panel]))
  const placed = new Set<string>()
  const ordered: T[] = []
  for (const id of arrangement) {
    const panel = known.get(id)
    if (!panel || placed.has(id)) continue
    placed.add(id)
    ordered.push(panel)
  }
  // Whatever the arrangement does not name yet - a plugin added since it was made -
  // keeps the registry's order, after the blocks the person placed.
  for (const panel of panels) if (!placed.has(panel.id)) ordered.push(panel)
  return ordered
}

/** The order after moving the block at `from` into the place of the block at `to`. */
export function movePanel(ids: readonly string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return [...ids]
  const moved = [...ids]
  moved.splice(to, 0, ...moved.splice(from, 1))
  return moved
}

/**
 * The order after dropping the block at `from` into the gap at `at`. A gap is a place
 * between two blocks - `0` is before the first, `ids.length` is after the last - and
 * the block leaves its own place before it takes one, so a gap below it counts one
 * lower once it is out.
 */
export function dropPanel(ids: readonly string[], from: number, at: number): string[] {
  if (from < 0 || from >= ids.length || at < 0 || at > ids.length) return [...ids]
  return movePanel(ids, from, from < at ? at - 1 : at)
}

/**
 * The arrangement a move leaves behind: the order now on screen, then the ids it does
 * not show, in the order the arrangement already had them. Arranging the rail while a
 * block is switched off does not throw that block's place away, so switching it back
 * on does not drop it in behind plugins that were never arranged.
 */
export function rememberArrangement(
  visible: readonly string[],
  previous: readonly string[],
): string[] {
  const shown = new Set(visible)
  return [...visible, ...previous.filter((id) => !shown.has(id))]
}

/**
 * Reads a saved layout whether or not it recorded a rail order. A document saved
 * before the rail was part of a layout is the dock arrangement on its own, and opens
 * with the rail the way it already is.
 */
export function readSavedLayout<T>(entry: T | SavedLayout<T>): OpenableLayout<T> {
  const candidate = entry as SavedLayout<T> | null
  if (!candidate || typeof candidate !== 'object' || !candidate.layout)
    return { layout: entry as T, rail: null }
  return { layout: candidate.layout, rail: readRailOrder(candidate.rail) }
}
