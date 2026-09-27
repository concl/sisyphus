import type { PlannerItem } from '@sisyphus/sdk'
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()

/** Search the full repository, independently of month, visibility and task filters. */
export function searchRecords(records: PlannerItem[], query: string) {
  const terms = normalize(query.trim()).split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  return records
    .filter(
      (item) =>
        !item.deleted &&
        terms.every((term) =>
          normalize(
            [item.title, item.description, item.location, item.list].filter(Boolean).join(' '),
          ).includes(term),
        ),
    )
    .sort(
      (a, b) =>
        Number(normalize(b.title).includes(normalize(query.trim()))) -
          Number(normalize(a.title).includes(normalize(query.trim()))) ||
        (a.date || '9999').localeCompare(b.date || '9999') ||
        a.title.localeCompare(b.title),
    )
}
