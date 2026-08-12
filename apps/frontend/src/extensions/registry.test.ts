import { describe, expect, it, vi } from 'vitest'
import { pages } from './index'
import { getPages, registerExtensionPages, subscribePages } from './registry'

describe('page registry', () => {
  it('has unique page ids', () => {
    const ids = pages.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every entry satisfies the ExtensionPage contract', () => {
    for (const p of pages) {
      expect(p.id.length).toBeGreaterThan(0)
      expect(p.title.length).toBeGreaterThan(0)
      expect(p.icon.length).toBeGreaterThan(0)
      expect(typeof p.keepAlive).toBe('boolean')
      expect(typeof p.component).toBe('function')
    }
  })
})

describe('runtime registry store', () => {
  it('starts with the compile-time pages and appends runtime ones', () => {
    const before = getPages().length
    registerExtensionPages([
      { id: 'x', title: 'X', icon: 'icon-plug', keepAlive: false, component: () => null },
    ])
    expect(getPages().length).toBe(before + 1)
    expect(getPages().some((p) => p.id === 'x')).toBe(true)
  })

  it('notifies subscribers when pages are added', () => {
    const listener = vi.fn()
    const unsubscribe = subscribePages(listener)
    registerExtensionPages([
      { id: 'y', title: 'Y', icon: 'icon-plug', keepAlive: false, component: () => null },
    ])
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    registerExtensionPages([
      { id: 'z', title: 'Z', icon: 'icon-plug', keepAlive: false, component: () => null },
    ])
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
