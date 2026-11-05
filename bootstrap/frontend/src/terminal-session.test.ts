import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Desktop } from '@sisyphus/sdk'
import type { SessionStatus } from '../../../plugins/terminal/frontend/types'

const { terminals, observers } = vi.hoisted(() => ({
  terminals: [] as Array<{
    write: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    open: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
  }>,
  observers: [] as Array<{ disconnect: ReturnType<typeof vi.fn> }>,
}))
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    write = vi.fn()
    writeln = vi.fn()
    dispose = vi.fn()
    open = vi.fn()
    focus = vi.fn()
    loadAddon = vi.fn()
    onData = vi.fn(() => ({ dispose: vi.fn() }))
    constructor() {
      terminals.push(this)
    }
  },
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn()
  },
}))
import { terminalSessionFactory } from '../../../plugins/terminal/frontend/session'

function element() {
  return {
    className: '',
    clientWidth: 600,
    clientHeight: 300,
    parentElement: null as unknown,
    append(child: { parentElement: unknown }) {
      child.parentElement = this
    },
    remove() {
      this.parentElement = null
    },
  }
}
function setup(spawn = async () => ({ pid: 42 })) {
  const handlers = new Map<string, Set<(event: unknown) => void>>()
  const call = vi.fn(async (method: string) => (method === 'terminal.spawn' ? spawn() : undefined))
  const desktop = {
    call,
    on(name: string, handler: (event: unknown) => void) {
      const subscribers = handlers.get(name) ?? new Set()
      handlers.set(name, subscribers)
      subscribers.add(handler)
      return () => subscribers.delete(handler)
    },
  } as unknown as Desktop
  const status = vi.fn<(status: SessionStatus) => void>()
  const factory = terminalSessionFactory(desktop)
  const session = factory({ id: 'powershell', name: 'PowerShell' }, status)
  const id = (call.mock.calls[0] as unknown as [string, { id: string }])[1]?.id
  return {
    session,
    factory,
    status,
    call,
    id,
    emit(name: string, event: unknown) {
      handlers.get(name)?.forEach((handler) => handler(event))
    },
    subscriberCount: () => [...handlers.values()].reduce((sum, set) => sum + set.size, 0),
  }
}

beforeEach(() => {
  terminals.length = 0
  observers.length = 0
  vi.stubGlobal('document', { createElement: () => element() })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      disconnect = vi.fn()
      observe = vi.fn()
      constructor() {
        observers.push(this)
      }
    },
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('terminal session lifetime', () => {
  it('keeps output and the same emulator while its view is detached', async () => {
    const { session, call, emit, id } = setup()
    const host = element() as unknown as HTMLElement
    const detach = session.attach(host)
    detach()
    emit('terminal.data', { id, data: 'Background output' })
    expect(terminals[0].write).toHaveBeenCalledWith('Background output')
    expect(call.mock.calls.filter(([method]) => method === 'terminal.kill')).toEqual([])
    session.attach(element() as unknown as HTMLElement)
    expect(terminals[0].open).toHaveBeenCalledTimes(1)
    await session.dispose()
    expect(terminals[0].dispose).toHaveBeenCalledTimes(1)
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1)
  })

  it('waits for a pending spawn before killing and unsubscribes immediately on close', async () => {
    let complete!: (value: { pid: number }) => void
    const { session, call, status, subscriberCount } = setup(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    const closing = session.dispose()
    expect(subscriberCount()).toBe(0)
    expect(call.mock.calls.filter(([method]) => method === 'terminal.kill')).toHaveLength(0)
    complete({ pid: 42 })
    await closing
    await session.dispose()
    expect(call.mock.calls.filter(([method]) => method === 'terminal.kill')).toHaveLength(1)
    expect(status).not.toHaveBeenCalled()
  })

  it('does not mark a session running if it exits before spawn resolves', async () => {
    let complete!: (value: { pid: number }) => void
    const { session, status, emit, id } = setup(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    emit('terminal.exit', { id, exitCode: 7 })
    complete({ pid: 42 })
    await Promise.resolve()
    expect(status.mock.calls.map(([value]) => value.state)).toEqual(['exited'])
    await session.dispose()
  })

  it('filters other sessions events and reports spawn failures without leaking listeners', async () => {
    const { session, status, emit, subscriberCount } = setup(async () => {
      throw new Error('Shell unavailable')
    })
    emit('terminal.data', { id: 'another-session', data: 'Other output' })
    expect(terminals[0].write).not.toHaveBeenCalled()
    await vi.waitFor(() =>
      expect(status).toHaveBeenCalledWith({ state: 'error', message: 'Shell unavailable' }),
    )
    await session.dispose()
    expect(subscriberCount()).toBe(0)
  })
})
