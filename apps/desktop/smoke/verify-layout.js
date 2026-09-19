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
  const loaded = new Promise((resolve) => wc.once('did-finish-load', resolve))
  wc.reload()
  await loaded
  await delay(600)
  const restored = await measure()
  assert.ok(Math.abs(restored.width - resized.width) < 3, 'Panel sizes must survive reload')
  await wc.executeJavaScript(`document.querySelector('[aria-label="Reset layout"]').click()`)
  await delay(500)
  return { panelResize: true, layoutRestored: true }
}
