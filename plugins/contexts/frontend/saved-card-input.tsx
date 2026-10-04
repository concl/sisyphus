import { useEffect, useState } from 'react'
import type { Desktop } from '@sisyphus/sdk'
import type { ActionInputProps } from '../../actions/frontend/presentations'
import type { Flow } from './action-model'

export function SavedCardInput({
  value,
  change,
  disabled,
  desktop,
}: ActionInputProps & { desktop: Desktop }) {
  const [cards, setCards] = useState<Flow[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    let changed = false
    const off = desktop.on<Flow[]>('automations.changed', (cards) => {
      changed = true
      if (alive) setCards(cards)
    })
    void desktop
      .call<Flow[]>('automations.list')
      .then((cards) => {
        if (alive && !changed) setCards(cards)
      })
      .catch((error) => {
        if (alive) setError(String(error))
      })
    return () => {
      alive = false
      off()
    }
  }, [desktop])
  return (
    <>
      <select
        aria-label="Saved card"
        disabled={disabled}
        value={String(value ?? '')}
        onChange={(event) => change(event.target.value)}
      >
        <option value="">Choose a card</option>
        {value && !cards.some((card) => card.id === value) ? (
          <option value={String(value)}>Unavailable card</option>
        ) : null}
        {cards.map((card) => (
          <option key={card.id} value={card.id}>
            {card.title}
          </option>
        ))}
      </select>
      {error && <small role="alert">{error}</small>}
    </>
  )
}
