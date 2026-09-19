import { describe, expect, it } from 'vitest'
import { Follow, atEnd } from '../../../plugins/chat/src/follow'

/** A scroller holding `height` of content in a window of `visible`, scrolled to `top`. */
function scroller(height: number, visible: number, top: number) {
  return { scrollTop: top, scrollHeight: height, clientHeight: visible }
}

/** The same scroller sitting at its end. */
function atBottom(height: number, visible: number) {
  return scroller(height, visible, height - visible)
}

describe('transcript follow', () => {
  it('is at the end only when the end is in view, within the slack', () => {
    expect(atEnd(atBottom(1000, 400))).toBe(true)
    expect(atEnd(scroller(1000, 400, 590))).toBe(true)
    expect(atEnd(scroller(1000, 400, 500))).toBe(false)
    // Content shorter than the window is entirely on screen, so it is its own end.
    expect(atEnd(scroller(200, 400, 0))).toBe(true)
  })

  it('follows a reply that grows while the reader stays at the end', () => {
    const follow = new Follow()
    follow.observe(atBottom(1000, 400))
    expect(follow.active).toBe(true)
    follow.watch('thread-1', 'm1', 'assistant')
    follow.observe(atBottom(1600, 400))
    expect(follow.active).toBe(true)
  })

  it('stops following when the reader scrolls up, and follows again at the end', () => {
    const follow = new Follow()
    follow.watch('thread-1', 'm1', 'assistant')
    follow.observe(atBottom(1000, 400))
    // Reading history while the reply is still streaming.
    follow.observe(scroller(1400, 400, 200))
    expect(follow.active).toBe(false)
    // Reaching the end again takes the follow back.
    follow.observe(atBottom(1800, 400))
    expect(follow.active).toBe(true)
  })

  it('does not pull back a reader who scrolled up while the reply is streaming', () => {
    const follow = new Follow()
    follow.watch('thread-1', 'm2', 'user')
    follow.observe(scroller(1400, 400, 200))
    // The same turn reported again - a streaming update, a refresh - is not a new
    // send, so the reader keeps the position they chose.
    follow.watch('thread-1', 'm2', 'user')
    expect(follow.active).toBe(false)
  })

  it('leaves a reply that landed while the reader was away out of their way', () => {
    const follow = new Follow()
    follow.watch('thread-1', 'm1', 'assistant')
    follow.observe(scroller(1400, 400, 200))
    // The finished reply is written into the conversation: the model's own answer
    // is not a reason to scroll.
    follow.watch('thread-1', 'm2', 'assistant')
    expect(follow.active).toBe(false)
  })

  it('watches a turn the reader sends from anywhere in the history', () => {
    const follow = new Follow()
    follow.watch('thread-1', 'm1', 'assistant')
    follow.observe(scroller(1400, 400, 200))
    follow.watch('thread-1', 'm2', 'user')
    expect(follow.active).toBe(true)
  })

  it('opens a conversation at its newest content', () => {
    const follow = new Follow()
    follow.watch('thread-1', 'm1', 'assistant')
    follow.observe(scroller(1400, 400, 200))
    follow.watch('thread-2', 'm9', 'assistant')
    expect(follow.active).toBe(true)
  })

  it('has no reason to be anywhere but the end before the reader scrolls', () => {
    expect(new Follow().active).toBe(true)
  })
})
