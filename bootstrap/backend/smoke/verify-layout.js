const assert = require('node:assert/strict')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

module.exports = async function verifyLayout(window) {
  const wc = window.webContents
  await wc.executeJavaScript(`document.querySelector('[aria-label="Reset layout"]').click()`)
  await delay(400)
  const measure = () =>
    wc.executeJavaScript(`(() => {
    const rect = document.querySelector('.python-panel').getBoundingClientRect();
    const sash = [...document.querySelectorAll('.dv-sash')].map(el => el.getBoundingClientRect()).find(rect => rect.width > 0 && rect.width < 10 && rect.height > 100);
    return { width: rect.width, right: rect.right, viewport: innerWidth, sash: {x: Math.round(sash.x + sash.width / 2), y: Math.round(sash.y + sash.height / 2)} };
  })()`)
  const before = await measure()
  // Dispatch pointer events directly so the hidden smoke window need not steal focus.
  await wc.executeJavaScript(`(() => {
    const sash = [...document.querySelectorAll('.dv-sash')].find(el => { const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.width < 10 && rect.height > 100; });
    const options = {bubbles: true, clientX: ${before.sash.x}, clientY: ${before.sash.y}, pointerId: 1, button: 0, buttons: 1};
    sash.dispatchEvent(new PointerEvent('pointerdown', options));
    document.dispatchEvent(new PointerEvent('pointermove', {...options, clientX: options.clientX - 80}));
    document.dispatchEvent(new PointerEvent('pointerup', {...options, clientX: options.clientX - 80, buttons: 0}));
  })()`)
  await delay(500)
  const resized = await measure()
  assert.ok(
    Math.abs(resized.width - before.width) > 30,
    'Dragging the divider must resize its panels',
  )
  assert.ok(resized.right <= resized.viewport + 2, 'Panel content must remain inside the window')
  // The rail order is part of the layout: what the person arranges is what they see
  // when the window comes back. The arrangement is made here with the arrow key the
  // rail offers, which is the same record-and-save path a drag ends in.
  const railOrder = () =>
    wc.executeJavaScript(
      `[...document.querySelectorAll('.rail button[data-open]')].map((button) => button.dataset.open)`,
    )
  const arranged = await railOrder()
  assert.ok(arranged.length > 2, `The rail should offer blocks to arrange, got ${arranged.length}`)
  await wc.executeJavaScript(`(() => {
    const icons = [...document.querySelectorAll('.rail button[data-open]')]
    icons.at(-1).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }),
    )
  })()`)
  await delay(400)
  const moved = await railOrder()
  // Alt with an arrow key takes the place of the neighbouring block: the last block
  // moves above the one before it.
  const expected = [...arranged.slice(0, -2), arranged.at(-1), arranged.at(-2)]
  assert.deepEqual(moved, expected, 'Alt with an arrow key must move the block in the rail')
  const storedRail = await wc.executeJavaScript(
    `window.sisyphus.call('storage.get', { scope: 'ui.workspace', key: 'rail.v1' })`,
  )
  assert.deepEqual(storedRail, moved, 'The rail order must be saved as the layout is')
  const loaded = new Promise((resolve) => wc.once('did-finish-load', resolve))
  // A reload is something a person does, and the document that is leaving must not
  // take an error with it: a window that unmounts its root while the runtime still
  // tells its subscribers to draw throws where nobody can see it. The collector is
  // synchronous, so it is recorded before the document goes.
  await wc.executeJavaScript(`(() => {
    localStorage.removeItem('smoke.reloadError')
    const record = (value) => {
      try { localStorage.setItem('smoke.reloadError', String(value)) } catch {}
    }
    window.addEventListener('error', (event) => { if (event.message) record(event.message) })
    window.addEventListener('unhandledrejection', (event) => record(event.reason))
    return true
  })()`)
  wc.reload()
  await loaded
  await delay(600)
  const reloadError = await wc.executeJavaScript(`localStorage.getItem('smoke.reloadError')`)
  assert.strictEqual(
    reloadError,
    null,
    `Reloading the window must not leave an error behind: ${reloadError}`,
  )
  const restored = await measure()
  assert.ok(Math.abs(restored.width - resized.width) < 3, 'Panel sizes must survive reload')
  assert.deepEqual(await railOrder(), moved, 'The rail order must survive reload')
  await wc.executeJavaScript(`document.querySelector('[aria-label="Reset layout"]').click()`)
  await delay(500)
  return { panelResize: true, layoutRestored: true, railArranged: true }
}
