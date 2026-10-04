export function EventScheduleFields({
  type,
  timed,
  setTimed,
  date,
  setDate,
  last,
  setLast,
  start,
  setStart,
  end,
  setEnd,
}: {
  type: 'event' | 'todo'
  timed: boolean
  setTimed: (value: boolean) => void
  date: string
  setDate: (value: string) => void
  last: string
  setLast: (value: string) => void
  start: string
  setStart: (value: string) => void
  end: string
  setEnd: (value: string) => void
}) {
  return (
    <>
      {type === 'event' && (
        <label className="cal-check">
          <input type="checkbox" checked={!timed} onChange={(e) => setTimed(!e.target.checked)} />
          All day
        </label>
      )}
      <div className="cal-form-row">
        <label>
          {type === 'todo' ? 'Due date (optional)' : 'Start date'}
          <input
            type="date"
            required={type === 'event'}
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
            }}
          />
        </label>
        {type === 'event' && (
          <label>
            End date
            <input
              type="date"
              required
              min={date}
              value={last}
              onChange={(e) => setLast(e.target.value)}
            />
          </label>
        )}
      </div>
      {type === 'event' && timed && (
        <>
          <div className="cal-form-row">
            <label>
              Start time
              <input
                type="time"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              End time
              <input type="time" required value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
          <p className="cal-footnote">
            {Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_', ' ')}
          </p>
        </>
      )}
    </>
  )
}
