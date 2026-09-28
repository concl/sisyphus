const { z } = require('zod')
const { Computer } = require('./lib/computer')

module.exports = () => ({
  id: 'desktop.computer',
  name: 'Computer control',
  inject: ['agent.tools.v1'],
  apply(ctx) {
    if (process.platform !== 'win32') return
    const computer = new Computer()
    const registry = ctx.get('agent.tools.v1')
    const point = { x: z.number().int().min(0), y: z.number().int().min(0) }
    const frame = { screenshotId: z.string().min(1) }
    const definitions = [
      ['screenshot', z.object({ display: z.number().int().min(0).optional() }),
        'See the Windows desktop. Returns an image, screenshotId and display list. Coordinates for actions are pixels in this image. Call this first, and again after waiting for an app to load.'],
      ['click', z.object({ ...frame, ...point, button: z.enum(['left', 'right', 'middle']).default('left'), count: z.number().int().min(1).max(2).default(1) }),
        'Click a location in the latest screenshot; returns a fresh screenshot.'],
      ['type', z.object({ ...frame, text: z.string().min(1).max(10000) }),
        'Type Unicode text into the focused control; returns a fresh screenshot. Click the intended field first.'],
      ['key', z.object({ ...frame, keys: z.array(z.string().min(1).max(20)).min(1).max(5) }),
        'Press a key or chord, for example ["CTRL", "L"], ["ALT", "TAB"], ["ENTER"]. Supports letters, digits, F1-F12, arrows, ESC, TAB, SPACE, BACKSPACE, DELETE, HOME, END, PAGEUP, PAGEDOWN, CTRL, SHIFT, ALT, WIN. Returns a screenshot.'],
      ['scroll', z.object({ ...frame, ...point, amount: z.number().int().min(-20).max(20) }),
        'Scroll at a screenshot location. Positive amount scrolls up, negative down, in wheel notches. Returns a screenshot.'],
      ['drag', z.object({ ...frame, ...point, toX: z.number().int().min(0), toY: z.number().int().min(0) }),
        'Drag from (x,y) to (toX,toY) in the latest screenshot with the left mouse button. Returns a screenshot.'],
      ['release', z.object({}), 'Release desktop ownership so another conversation can use it. Ownership is also released when this reply ends.'],
    ]
    for (const [action, schema, description] of definitions) ctx.effect(() => registry.register(`computer_${action}`, {
      description,
      access: 'write',
      inputSchema: schema.strict(),
      execute: (input, context) => computer.execute(action, schema.strict().parse(input), context),
      endRun: ({ runId }) => computer.release(runId),
    }))
    ctx.effect(() => () => computer.dispose())
  },
})
