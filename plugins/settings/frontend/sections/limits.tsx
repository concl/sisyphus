import type { ChatLimits } from '@sisyphus/sdk'
import { ChatSection, type ChatSectionProps } from './chat'

const fields: Array<{ key: keyof ChatLimits; label: string; max: number; hint: string }> = [
  {
    key: 'maxSteps',
    label: 'Tool steps per reply',
    max: 1000,
    hint: 'Maximum model calls in one reply. 0 means no limit.',
  },
  {
    key: 'maxRetries',
    label: 'Retries per model call',
    max: 10,
    hint: 'Retries after a model call fails. 0 means no retries.',
  },
  {
    key: 'firstChunkSeconds',
    label: 'Seconds before the reply starts',
    max: 3600,
    hint: 'Time to wait for the first output. 0 means no timeout.',
  },
  {
    key: 'chunkSeconds',
    label: 'Seconds of silence between chunks',
    max: 3600,
    hint: 'Time to wait between outputs. Time spent running tools is excluded. 0 means no timeout.',
  },
  {
    key: 'toolSeconds',
    label: 'Tool seconds per call',
    max: 86400,
    hint: 'Maximum time for one tool call. 0 means no timeout.',
  },
]

export function LimitSettings({ store }: ChatSectionProps) {
  return (
    <ChatSection store={store}>
      {(config) => (
        <>
          {fields.map((field) => (
            <div className="settings-field" key={field.key}>
              <label>
                {field.label}
                <input
                  aria-label={field.label}
                  type="number"
                  min={0}
                  max={field.max}
                  step={1}
                  value={config.limits[field.key]}
                  onChange={(event) => {
                    const parsed = Math.round(Number(event.target.value))
                    const value = Number.isFinite(parsed)
                      ? Math.max(0, Math.min(field.max, parsed))
                      : config.defaultLimits[field.key]
                    store.edit({ limits: { ...config.limits, [field.key]: value } })
                  }}
                />
              </label>
              <p className="settings-hint">{field.hint}</p>
            </div>
          ))}
          <div className="settings-actions">
            <button
              onClick={() =>
                store.edit({
                  limits: {
                    ...config.limits,
                    maxSteps: 0,
                    firstChunkSeconds: 0,
                    chunkSeconds: 0,
                    toolSeconds: 0,
                  },
                })
              }
            >
              Remove limits
            </button>
            <button onClick={() => store.edit({ limits: { ...config.defaultLimits } })}>
              Restore default limits
            </button>
          </div>
        </>
      )}
    </ChatSection>
  )
}
