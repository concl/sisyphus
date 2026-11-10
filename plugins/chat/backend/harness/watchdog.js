'use strict'

// The silence watchdog that surrounds any harness. It watches the normalized
// event stream rather than provider-specific parts, so a swapped harness gets
// the same "the model went quiet" behavior. Time spent inside one of our tools
// or inside harness preparation is suspended: those are allowed to be slow.
class StallError extends Error {
  constructor(stage, ms) {
    super(`${stage} timeout of ${Math.round(ms)}ms exceeded`)
    this.name = 'TimeoutError'
    this.stage = stage
    this.ms = ms
  }
}

/**
 * @param {{ firstChunkMs?: number, chunkMs?: number, onStall: (error: StallError) => void }} options
 */
function createWatchdog({ firstChunkMs, chunkMs, onStall }) {
  let spoke = false
  let tools = 0
  let work = 0
  let timer = null
  let stopped = false
  let stalled = null
  let budget = null

  const clear = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  const tick = () => {
    timer = null
    if (stopped) return
    if (tools > 0 || work > 0) {
      arm()
      return
    }
    stalled = new StallError(spoke ? 'chunk' : 'first', budget)
    stopped = true
    onStall(stalled)
  }
  const arm = () => {
    clear()
    if (stopped) return
    if (tools > 0 || work > 0) return
    budget = spoke ? chunkMs : firstChunkMs
    if (!budget) return
    timer = setTimeout(tick, budget)
  }

  return {
    get stalled() {
      return stalled
    },
    start: arm,
    noteSpeaking() {
      if (stopped) return
      spoke = true
      arm()
    },
    toolStart() {
      if (stopped) return
      spoke = true
      tools++
      arm()
    },
    toolEnd() {
      if (stopped) return
      tools = Math.max(0, tools - 1)
      arm()
    },
    beginWork() {
      work++
      clear()
    },
    endWork() {
      work = Math.max(0, work - 1)
      arm()
    },
    stop() {
      stopped = true
      clear()
    },
  }
}

module.exports = { createWatchdog, StallError }
