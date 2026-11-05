import { describe, expect, it, vi } from 'vitest'
import type { Backend, Desktop } from '@sisyphus/sdk'
import { createTerminalStore } from '../../../plugins/terminal/frontend/store'
import type { SessionStatus, TerminalSession } from '../../../plugins/terminal/frontend/types'
import { duplicateSingletonPanels } from '../../../plugins/workspace/frontend/layout'

const backends: Backend[] = [
  { id: 'powershell', name: 'PowerShell' },
  { id: 'cmd', name: 'Command Prompt' },
]
function setup(call = async () => ({ backends, defaultId: 'powershell' })) {
  const desktop = { call: vi.fn(call), on: () => () => {} } as unknown as Desktop
  const sessions: Array<{
    shell: Backend
    status: (status: SessionStatus) => void
    engine: TerminalSession
  }> = []
  const factory = vi.fn((shell: Backend, status: (status: SessionStatus) => void) => {
    const engine = { attach: vi.fn(() => () => {}), focus: vi.fn(), dispose: vi.fn(async () => {}) }
    sessions.push({ shell, status, engine })
    return engine
  })
  return { store: createTerminalStore(desktop, factory), sessions, desktop, factory }
}

describe('terminal tabs', () => {
  it('opens one default shell, and changing the picker only affects a new tab', async () => {
    const { store, sessions, desktop } = setup()
    await Promise.all([store.loadBackends(), store.loadBackends()])
    expect(desktop.call).toHaveBeenCalledTimes(1)
    const first = store.getSnapshot().tabs[0]
    store.setShell('cmd')
    expect(store.getSnapshot().tabs).toEqual([first])
    expect(sessions).toHaveLength(1)
    const second = store.open()!
    expect(store.getSnapshot().tabs.map((tab) => tab.shell.id)).toEqual(['powershell', 'cmd'])
    expect(store.getSnapshot().activeId).toBe(second)
    expect(sessions[0].engine.dispose).not.toHaveBeenCalled()
    store.select(first.id)
    expect(store.session(first.id)).toBe(sessions[0].engine)
    expect(sessions).toHaveLength(2)
    await store.dispose()
  })

  it('closes only the chosen session, selects its neighbor, and leaves the last tab closed on remount', async () => {
    const { store, sessions } = setup()
    await store.loadBackends()
    const first = store.getSnapshot().activeId!
    const second = store.open('cmd')!
    const third = store.open('powershell')!
    store.select(second)
    await store.close(second)
    expect(store.getSnapshot().activeId).toBe(third)
    expect(sessions[1].engine.dispose).toHaveBeenCalledTimes(1)
    expect(sessions[0].engine.dispose).not.toHaveBeenCalled()
    await store.close(third)
    expect(store.getSnapshot().activeId).toBe(first)
    await store.close(first)
    await store.loadBackends()
    expect(store.getSnapshot()).toMatchObject({ tabs: [], activeId: null })
    expect(sessions).toHaveLength(3)
    store.open('cmd')
    expect(store.getSnapshot().tabs[0].title).toBe('Command Prompt 4')
    await store.dispose()
  })

  it('waits for the old session to close on restart and ignores its late status events', async () => {
    const { store, sessions } = setup()
    await store.loadBackends()
    const first = store.getSnapshot().activeId!
    const other = store.open('cmd')!
    let finish!: () => void
    vi.mocked(sessions[0].engine.dispose).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const restarting = store.restart(first)
    expect(sessions).toHaveLength(2)
    sessions[0].status({ state: 'exited', exitCode: 1 })
    expect(store.getSnapshot().tabs[0].status.state).toBe('starting')
    finish()
    await restarting
    expect(sessions).toHaveLength(3)
    expect(sessions[2].shell.id).toBe('powershell')
    expect(store.getSnapshot().tabs.map((tab) => tab.id)).toEqual([first, other])
    expect(sessions[1].engine.dispose).not.toHaveBeenCalled()
    sessions[0].status({ state: 'running', pid: 1 })
    sessions[2].status({ state: 'running', pid: 2 })
    expect(store.getSnapshot().tabs[0].status.pid).toBe(2)
    await store.dispose()
  })

  it('does not recreate a tab closed while restart is waiting', async () => {
    const { store, sessions } = setup()
    await store.loadBackends()
    const id = store.getSnapshot().activeId!
    let finish!: () => void
    vi.mocked(sessions[0].engine.dispose).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const restarting = store.restart(id)
    await store.close(id)
    finish()
    await restarting
    expect(sessions).toHaveLength(1)
    expect(store.getSnapshot().tabs).toEqual([])
    await store.dispose()
  })

  it('retains exited tabs for inspecting output and disposes every session when disabled', async () => {
    const { store, sessions } = setup()
    await store.loadBackends()
    store.open('cmd')
    sessions[0].status({ state: 'exited', exitCode: 0 })
    expect(store.getSnapshot().tabs).toHaveLength(2)
    expect(store.getSnapshot().tabs[0].status).toEqual({ state: 'exited', exitCode: 0 })
    await store.dispose()
    expect(
      sessions.every((session) => vi.mocked(session.engine.dispose).mock.calls.length === 1),
    ).toBe(true)
    store.open('cmd')
    expect(sessions).toHaveLength(2)
  })

  it('supports retry after shell detection fails without losing existing tabs', async () => {
    let fail = true
    const { store, sessions } = setup(async () => {
      if (fail) throw new Error('Shell detection failed')
      return { backends, defaultId: 'missing-default' }
    })
    await store.loadBackends()
    expect(store.getSnapshot().error).toBe('Shell detection failed')
    expect(sessions).toHaveLength(0)
    fail = false
    await store.loadBackends()
    expect(store.getSnapshot().tabs[0].shell.id).toBe('powershell')
    const snapshot = store.getSnapshot().tabs
    await store.loadBackends()
    expect(store.getSnapshot().tabs).toBe(snapshot)
    expect(sessions).toHaveLength(1)
    await store.dispose()
  })

  it('does not spawn a session after disposal during shell detection', async () => {
    let finish!: (result: { backends: Backend[]; defaultId: string }) => void
    const { store, sessions } = setup(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const loading = store.loadBackends()
    await store.dispose()
    finish({ backends, defaultId: 'cmd' })
    await loading
    expect(sessions).toEqual([])
  })
})

describe('singleton workspace panels', () => {
  it('collapses old duplicate terminals while keeping the active instance and explicitly multiple panels', () => {
    const blocks = [
      { id: 'terminal-1', params: { type: 'terminal' } },
      { id: 'terminal-2', params: { type: 'terminal' } },
      { id: 'other-1', params: { type: 'other' } },
      { id: 'other-2', params: { type: 'other' } },
    ]
    const definitions = [{ id: 'terminal' }, { id: 'other', multiple: true }]
    expect(duplicateSingletonPanels(blocks, definitions, 'terminal-2')).toEqual([blocks[0]])
    expect(duplicateSingletonPanels(blocks, definitions)).toEqual([blocks[1]])
    expect(duplicateSingletonPanels(blocks, [])).toEqual([])
  })
})
