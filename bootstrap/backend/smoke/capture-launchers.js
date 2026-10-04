const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Optional visual fixtures run only inside the smoke test's disposable profile.
module.exports = async function captureLaunchers(window, directory) {
  fs.mkdirSync(directory, { recursive: true })
  const wc = window.webContents
  await wc.executeJavaScript(`(async () => {
    const locations = await window.sisyphus.call('data.locations');
    const project = locations.find(item => item.id === 'all').path;
    await window.sisyphus.call('automations.save', {
      id: 'workday', title: 'Start my workday', description: 'Your project and reference pages, ready together.', color: 'blue',
      nodes: [
        {id: 'project', type: 'open', title: 'Open project', x: 320, y: 60, config: { targets: [project], application: 'editor', window: 'new' }},
        {id: 'references', type: 'open', title: 'Open reference tabs', x: 320, y: 240, config: { targets: ['https://developer.mozilla.org/', 'https://github.com/'], application: 'default' }},
        {id: 'pause', type: 'wait', title: 'Take a breath', x: 620, y: 140, config: { mode: 'duration', seconds: 1 }},
      ],
      edges: [{from: 'start', to: 'project'}, {from: 'start', to: 'references'}, {from: 'project', to: 'pause'}, {from: 'references', to: 'pause'}]
    });
    await window.sisyphus.call('automations.save', {
      id: 'reading', title: 'Reference library', description: 'The pages you come back to, together.', color: 'purple',
      inputs: [{ key: 'websites', label: 'Websites', kind: 'urls', value: ['https://developer.mozilla.org/', 'https://github.com/'] }],
      nodes: [{id: 'tabs', type: 'open', title: 'Open tabs', x: 320, y: 60, config: { targets: [], application: 'default' }, bindings: { targets: 'websites' }}],
      edges: [{from: 'start', to: 'tabs'}]
    });
    await window.sisyphus.call('appearance.set', { theme: 'light' });
    document.querySelector('[aria-label="Open Actions"]').click();
  })()`)
  const capture = async (name) => {
    await delay(350)
    fs.writeFileSync(path.join(directory, `${name}.png`), (await wc.capturePage()).toPNG())
  }
  await capture('actions-grid')
  await capture('actions-card-inputs')
  await wc.executeJavaScript(
    `document.querySelector('[aria-label="Edit Start my workday"]').click()`,
  )
  await delay(100)
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('.action-zoom button')).find(button => button.textContent === 'Fit').click()`,
  )
  await delay(100)
  // Exercise real pointer events, including pointer capture and scaled coordinates.
  const position = await wc.executeJavaScript(`(() => {
    const element = document.querySelector('[aria-label="Connect to Open reference tabs"]').closest('.action-node');
    const rect = element.querySelector('.action-node-body').getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), left: parseFloat(element.style.left) };
  })()`)
  wc.sendInputEvent({
    type: 'mouseDown',
    x: position.x,
    y: position.y,
    button: 'left',
    clickCount: 1,
  })
  wc.sendInputEvent({ type: 'mouseMove', x: position.x + 20, y: position.y - 12 })
  wc.sendInputEvent({
    type: 'mouseUp',
    x: position.x + 20,
    y: position.y - 12,
    button: 'left',
    clickCount: 1,
  })
  await delay(100)
  const moved = await wc.executeJavaScript(
    `parseFloat(document.querySelector('[aria-label="Connect to Open reference tabs"]').closest('.action-node').style.left)`,
  )
  assert.ok(moved > position.left + 10, 'Dragging a scaled step should move it')
  const ports =
    await wc.executeJavaScript(`['Connect from Start', 'Connect to Take a breath'].map(label => {
    const rect = document.querySelector('[aria-label="' + label + '"]').getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  })`)
  wc.sendInputEvent({ type: 'mouseDown', ...ports[0], button: 'left', clickCount: 1 })
  wc.sendInputEvent({ type: 'mouseMove', ...ports[1] })
  wc.sendInputEvent({ type: 'mouseUp', ...ports[1], button: 'left', clickCount: 1 })
  await delay(100)
  assert.equal(
    await wc.executeJavaScript(`document.querySelectorAll('.action-wire-hit').length`),
    5,
    'Dragging between ports should add a connection',
  )
  await wc.executeJavaScript(
    `document.querySelector('[aria-label="Connection from Start to Take a breath"]').dispatchEvent(new MouseEvent('click', {bubbles:true}))`,
  )
  await delay(50)
  await wc.executeJavaScript(`document.querySelector('.action-inspector .action-remove').click()`)
  await delay(50)
  assert.equal(
    await wc.executeJavaScript(`document.querySelectorAll('.action-wire-hit').length`),
    4,
    'The selected connection should be removable',
  )
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('.actions-heading-buttons button')).find(button => button.textContent === 'Save').click()`,
  )
  await delay(100)
  const saved = await wc.executeJavaScript(
    `window.sisyphus.call('automations.list').then(flows => flows.find(flow => flow.id === 'workday').nodes.find(node => node.id === 'references').x)`,
  )
  assert.ok(
    Math.abs(saved - moved) < 0.01,
    'Dragged positions should persist within CSS serialization precision',
  )
  await wc.executeJavaScript(`document.querySelector('.action-start .action-node-body').click()`)
  await delay(100)
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('.action-zoom button')).find(button => button.textContent === 'Fit').click()`,
  )
  await capture('actions-graph')
  await wc.executeJavaScript(`(async () => {
    await window.sisyphus.call('appearance.set', { theme: 'dark' });
    document.querySelector('[aria-label="Connect to Open project"]').closest('.action-node').querySelector('.action-node-body').click();
  })()`)
  window.setSize(900, 700)
  await delay(200)
  await capture('actions-inspector-dark-narrow')
  window.setSize(1320, 900)
  await wc.executeJavaScript(`(async () => {
    await window.sisyphus.call('appearance.set', { theme: 'light' });
    Array.from(document.querySelectorAll('.actions-heading-buttons button')).find(button => button.textContent === 'Back to cards').click();
  })()`)
  await delay(100)
  await wc.executeJavaScript(
    `document.querySelector('[aria-label="Edit Make a greeting"]').click()`,
  )
  await delay(100)
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('.action-zoom button')).find(button => button.textContent === 'Fit').click(); document.querySelector('[aria-label="Connect to Greeting"]').closest('.action-node').querySelector('.action-node-body').click()`,
  )
  await capture('workflow-result-binding')
  await wc.executeJavaScript(`document.querySelector('.action-add-button').click()`)
  await capture('workflow-service-catalog')
  await wc.executeJavaScript(
    `document.querySelector('.action-add-button').click(); Array.from(document.querySelectorAll('.actions-heading-buttons button')).find(button => button.textContent === 'Back to cards').click()`,
  )
  await delay(100)
  await wc.executeJavaScript(`(() => {
    const search = document.querySelector('[aria-label="Filter actions"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, 'Create planning event');
    search.dispatchEvent(new Event('input', {bubbles: true}));
  })()`)
  await capture('calendar-action-card')
  await require('./actions-usability')(window, capture)
}
