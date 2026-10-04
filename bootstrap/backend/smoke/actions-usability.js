const assert = require('node:assert/strict')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Native input events exercise focus, keyboard handling, modal blocking and React
// updates. These fixtures use the disposable smoke profile and never open websites.
module.exports = async function actionsUsability(window, capture) {
  const wc = window.webContents
  const evaluate = (code) => wc.executeJavaScript(code)
  async function wait(code, label) {
    const until = Date.now() + 4000
    while (Date.now() < until) {
      if (await evaluate(code)) return
      await delay(25)
    }
    throw new Error(
      `Actions usability: ${label}; ${await evaluate(`JSON.stringify({focus:document.activeElement?.outerHTML,invalid:[...document.querySelectorAll('[aria-invalid="true"],:invalid')].map(element=>element.outerHTML),error:document.querySelector('.action-error')?.textContent})`)}`,
    )
  }
  async function click(selector) {
    const point = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('Missing control: ' + ${JSON.stringify(selector)});
      element.scrollIntoView({block:'nearest'});
      const rect = element.getBoundingClientRect();
      const x = Math.round(rect.x + rect.width / 2), y = Math.round(rect.y + rect.height / 2);
      const hit = document.elementFromPoint(x, y);
      if (hit !== element && !element.contains(hit)) throw new Error('Control is covered: ' + ${JSON.stringify(selector)});
      return {x, y};
    })()`)
    wc.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
    await delay(25)
  }
  const key = (keyCode, modifiers = []) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    if (keyCode === 'Enter') wc.sendInputEvent({ type: 'char', keyCode: '\r', modifiers })
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }
  async function type(selector, value) {
    await click(selector)
    key('A', ['control'])
    if (value) await wc.insertText(value)
    else key('Backspace')
    await delay(25)
    assert.equal(
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`),
      value,
      `Typing into ${selector} should replace its value`,
    )
  }

  const originalTitle = await evaluate(
    `document.querySelector('.action-event-summary strong').textContent`,
  )
  assert.ok(
    await evaluate(`document.querySelector('.action-card').getBoundingClientRect().height < 260`),
    'A structured input must not expand the card into a full form',
  )
  await click('[aria-label="Edit Event input"]')
  await wait(`document.querySelector('.action-input-dialog[open]')`, 'event dialog opens')
  assert.equal(
    await evaluate(`document.activeElement.getAttribute('aria-label')`),
    'Event title',
    'Opening the dialog should focus the first input',
  )
  await capture('calendar-input-dialog')
  await type('.action-input-dialog [aria-label="Event title"]', 'Discarded draft')
  key('Escape')
  await wait(`!document.querySelector('.action-input-dialog')`, 'Escape closes the dialog')
  assert.equal(
    await evaluate(`document.querySelector('.action-event-summary strong').textContent`),
    originalTitle,
    'Escape must discard the draft',
  )
  assert.equal(
    await evaluate(`document.activeElement.getAttribute('aria-label')`),
    'Edit Event input',
    'Closing the dialog should restore focus',
  )

  await click('[aria-label="Edit Event input"]')
  await wait(`document.querySelector('.action-input-dialog[open]')`, 'event dialog reopens')
  await type('.action-input-dialog [aria-label="Event title"]', '')
  await click('.action-input-dialog footer .primary')
  assert.ok(
    await evaluate(`Boolean(document.querySelector('.action-input-dialog[open]'))`),
    'Invalid input must keep the dialog open',
  )
  await type('.action-input-dialog [aria-label="Event title"]', originalTitle)
  key('Enter')
  await wait(`!document.querySelector('.action-input-dialog')`, 'Enter applies the valid dialog')

  await type('[aria-label="Filter actions"]', 'Reference library')
  await wait(
    `document.querySelector('[aria-label="Run Reference library"]')`,
    'website fixture is visible',
  )
  await type('.action-card textarea', 'https://example.org/quick-edit')
  await type('[aria-label="Filter actions"]', 'No matching card')
  await wait(
    `window.sisyphus.call('automations.list').then(cards => cards.find(card => card.id === 'reading').inputs[0].value[0] === 'https://example.org/quick-edit')`,
    'navigation flushes the pending card input',
  )
  await type('[aria-label="Filter actions"]', 'Reference library')
  await wait(
    `document.querySelector('.action-card textarea')?.value === 'https://example.org/quick-edit'`,
    'the saved value returns on remount',
  )
  await click('[aria-label="Edit Reference library"]')
  await wait(
    `document.querySelector('.action-inspector textarea')`,
    'editing selects the first step',
  )
  await click('[aria-label="Show Files, folders or websites on card"]')
  assert.equal(
    await evaluate(`document.querySelector('.action-inspector textarea').value`),
    'https://example.org/quick-edit',
    'Hiding a card input should preserve its literal setting',
  )
  await click('[aria-label="Show Files, folders or websites on card"]')
  assert.equal(
    await evaluate(`document.querySelector('.action-inspector textarea').value`),
    'https://example.org/quick-edit',
    'Exposing a setting should preserve its value',
  )
  window.setSize(900, 700)
  await delay(100)
  assert.ok(
    await evaluate(`(() => {
    const inspector = document.querySelector('.action-inspector').getBoundingClientRect();
    const builder = document.querySelector('.action-builder').getBoundingClientRect();
    const panel = document.querySelector('.actions-panel').getBoundingClientRect();
    return inspector.top >= builder.top && inspector.bottom <= panel.bottom && inspector.right <= panel.right;
  })()`),
    'At a narrow width the settings must stay visible beside the graph',
  )
  await click('[aria-label="Close step settings"]')
  await click('[aria-label="Card settings"]')
  await wait(
    `document.querySelector('.action-inspector h2')?.textContent === 'Card settings'`,
    'card settings can reopen in a narrow panel',
  )
  await capture('actions-settings-narrow')
  window.setSize(1320, 900)
  await evaluate(
    `Array.from(document.querySelectorAll('.actions-heading-buttons button')).find(button => button.textContent === 'Save').click()`,
  )
  await wait(
    `document.querySelector('.action-feedback')?.textContent === 'Saved.'`,
    'save exposure changes',
  )
  await evaluate(
    `Array.from(document.querySelectorAll('.actions-heading-buttons button')).find(button => button.textContent === 'Back to cards').click()`,
  )
  await evaluate(`window.sisyphus.call('automations.save', {
    id: 'numeric-input', title: 'Numeric input', inputs: [{key:'seconds',label:'Seconds',kind:'number',value:0,field:{kind:'number',min:0,max:86400}}],
    nodes:[{id:'wait',type:'system.wait',title:'Wait',config:{mode:'duration',seconds:0},bindings:{seconds:'seconds'}}],edges:[{from:'start',to:'wait'}]
  })`)
  await type('[aria-label="Filter actions"]', 'Numeric input')
  await wait(`document.querySelector('[aria-label="Run Numeric input"]')`, 'numeric card appears')
  await type('.action-card [aria-label="Seconds"]', '')
  await click('[aria-label="Run Numeric input"]')
  await wait(
    `document.querySelector('.action-card .action-error')`,
    'blank number prevents running',
  )
  assert.equal(
    await evaluate(
      `window.sisyphus.call('automations.runs').then(runs => runs.some(run => run.id === 'numeric-input'))`,
    ),
    false,
    'An invalid numeric draft must not run with its previous value',
  )
  await click('[aria-label="Edit Numeric input"]')
  await wait(
    `document.querySelector('.action-inspector [aria-label="Seconds"]')`,
    'invalid card input does not block Edit',
  )
  await click('[aria-label="Close step settings"]')
  await click('.action-add-button')
  await wait(
    `document.activeElement?.getAttribute('aria-label') === 'Find an action'`,
    'the service picker receives keyboard focus',
  )
  await wc.insertText('Format text')
  key('Enter')
  await wait(
    `document.querySelector('.action-inspector h2')?.textContent === 'Format text'`,
    'Enter adds the matching service action',
  )
  key('Escape')
  // Discard the deliberately unsaved test step through the existing close flow.
  await evaluate(`(() => {
    const previousConfirm = window.confirm;
    window.confirm = () => true;
    try { Array.from(document.querySelectorAll('.actions-heading-buttons button')).find(button => button.textContent === 'Back to cards').click(); }
    finally { window.confirm = previousConfirm; }
  })()`)
  await type('[aria-label="Filter actions"]', 'Create planning event')
  console.log(
    'ACTIONS_USABILITY_OK modal keyboard, validation, focus return, navigation saving, exposure, service search',
  )
}
