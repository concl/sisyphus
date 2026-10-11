// Run with node scripts/workflow-editor-smoke.cjs. Uses a temporary test profile;
// runtime delivery still uses plugins:sync against the user's installation.
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const backend = createRequire(path.join(root, 'bootstrap/backend/package.json'))
const output = path.join(root, 'build/workflow-editor-smoke')

async function prepare() {
  fs.mkdirSync(output, { recursive: true })
  await backend('esbuild').build({
    stdin: {
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { Actions } from './plugins/actions/frontend/actions';
        import { ActionPresentations } from './plugins/actions/frontend/presentations';
        import './plugins/theme/frontend/theme.css';
        import './bootstrap/frontend/src/index.css';
        const { ipcRenderer } = window.require('electron');
        const desktop = {
          call: (name, input) => ipcRenderer.invoke('test.call', name, input),
          on: (name, listener) => { const fn = (_, value) => listener(value); ipcRenderer.on(name, fn); return () => ipcRenderer.removeListener(name, fn); },
        };
        window.desktop = desktop;
        createRoot(document.getElementById('root')).render(<Actions desktop={desktop} presentations={new ActionPresentations()} />);
      `,
      resolveDir: root,
      loader: 'tsx',
    },
    bundle: true,
    outfile: path.join(output, 'harness.js'),
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'warning',
  })
  fs.writeFileSync(
    path.join(output, 'index.html'),
    '<!doctype html><html><head><link rel="stylesheet" href="harness.css"><style>html,body,#root{height:100%;margin:0}body{font-family:system-ui}button{font:inherit}</style></head><body><div id="root"></div><script src="harness.js"></script></body></html>',
  )
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(backend('electron'), [__filename, '--electron'], {
    stdio: 'inherit',
    env,
    windowsHide: true,
  })
  process.exitCode = result.status ?? 1
}

async function run() {
  const { app, BrowserWindow, ipcMain } = require('electron')
  app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')))
  await app.whenReady()
  const { Automations } = require('../plugins/actions/backend/lib/automations.js')
  const { AutomationFiles } = require('../plugins/actions/backend/lib/automation-files.js')
  const { checkProgram } = require('../plugins/actions/backend/lib/workflow-engine.js')
  const { dataActions } = require('../plugins/actions/backend/lib/data-actions.js')
  const { localActions } = require('../plugins/actions/backend/lib/action-runners.js')
  const { networkActions } = require('../plugins/actions/backend/lib/network-actions.js')
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
  })
  const engine = new Automations({
    files: new AutomationFiles(app.getPath('userData')),
    onRun: (run) => window.webContents.send('automations.run', run),
  })
  engine.actions.registerService('data', { name: 'Data', actions: dataActions() })
  const local = localActions({
    shell: {
      openExternal() {
        throw new Error('External effects are disabled in this test')
      },
    },
    integrations: {},
  })
  delete local.run
  engine.actions.registerService('system', { name: 'This computer', actions: local })
  engine.actions.registerService('web', { name: 'Web', actions: networkActions() })
  ipcMain.handle('test.call', (_, name, input) => {
    if (name === 'automations.list') return engine.list()
    if (name === 'automations.runs') return engine.snapshot()
    if (name === 'actions.list') return engine.types()
    if (name === 'automations.check')
      return checkProgram(input.flow, engine.actions, input.inputValues)
    if (name === 'automations.start') return engine.start(input.id, input.inputValues)
    if (name === 'automations.cancel') return engine.cancel(input.id)
    let result
    if (name === 'automations.save') result = engine.save(input)
    else if (name === 'automations.inputs.set')
      result = engine.setInputs(input.id, input.inputValues, input.drafts)
    else throw new Error(`Unexpected test call: ${name}`)
    window.webContents.send('automations.changed', engine.list())
    return result
  })
  const errors = []
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(details.message)
  })
  await window.loadFile(path.join(output, 'index.html'))
  const evaluate = (code) => window.webContents.executeJavaScript(code, true)
  await evaluate(`
    window.pause = () => new Promise(resolve => setTimeout(resolve, 80));
    window.expect = (ok, message) => { if (!ok) throw new Error(message); };
    window.waitFor = async fn => { for(let i=0;i<100;i++){ if(fn()) return; await pause(); } throw new Error('Timed out: '+fn.toString()); };
    window.button = text => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text && button.getClientRects().length);
    window.clickText = async text => { expect(button(text), 'Missing button: '+text); button(text).click(); await pause(); };
    window.fill = async (selector, value) => { const el=document.querySelector(selector); expect(el,'Missing field: '+selector); Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,'value').set.call(el,value); el.dispatchEvent(new Event('input',{bubbles:true})); await pause(); };
    window.addAction = async name => { await clickText('＋ Add step'); await waitFor(()=>document.querySelector('dialog[open]')); await fill('[aria-label="Find an action"]',name); const choice=[...document.querySelectorAll('.action-library-list button')].find(button=>button.querySelector('strong')?.textContent===name); expect(choice,'Missing library choice: '+name); choice.click(); await pause(); await clickText('Add '+name); };
    window.cards = () => desktop.call('automations.list');
    void 0;
  `)
  try {
    await evaluate(`(async()=>{
      await waitFor(()=>button('+ New workflow') && !button('+ New workflow').disabled);
      await clickText('+ New workflow');
      expect(document.querySelector('.workflow-outline'), 'Step list should be the default');
      await fill('[aria-label="Card title"]','Editor regression');
      await clickText('Save');
      expect((await cards())[0].nodes.length===0,'Empty draft was not saved');
      await addAction('Value');
      await fill('textarea[aria-label="Value"]','{"unfinished":');
      await clickText('Save');
      expect((await cards())[0].nodes[0].drafts.value==='{"unfinished":','Raw draft missing');
      const before=document.querySelector('.action-builder').getBoundingClientRect().top;
      await clickText('Save & run');
      expect((await desktop.call('automations.runs')).length===0,'Invalid draft executed');
      expect(document.querySelector('.action-builder').getBoundingClientRect().top===before,'Feedback shifted layout');
      document.querySelector('[aria-label="Close readiness"]').click(); await pause();
      document.querySelector('.workflow-start').click(); await pause();
      document.querySelector('.workflow-step').click(); await pause();
      expect(document.querySelector('textarea[aria-label="Value"]').value==='{"unfinished":','Switching steps lost draft');
      await clickText('Back to cards');
      document.querySelector('[aria-label="Edit Editor regression"]').click(); await pause();
      expect(document.querySelector('textarea[aria-label="Value"]').value==='{"unfinished":','Reopening lost draft');
      await fill('textarea[aria-label="Value"]','{"ok":true}');
      await clickText('Save & run');
      await waitFor(()=>document.body.textContent.includes('succeeded'));
      expect((await desktop.call('automations.runs'))[0].nodes[(await cards())[0].nodes[0].id].result.value.ok,'Repaired value did not run');
      await clickText('Reference');
      expect(document.querySelector('.action-reference').textContent.includes('State changes'),'Missing unified reference');
      await clickText('Settings');
      await addAction('Wait');
      await fill('input[aria-label="Seconds"]','');
      await clickText('Save');
      expect((await cards())[0].nodes[1].drafts.seconds==='','Empty number draft missing');
      await fill('input[aria-label="Seconds"]','0');
      await clickText('Save');
      expect(!(await cards())[0].nodes[1].drafts,'Repair left a stale draft marker');
      await clickText('Graph');
      expect(document.querySelector('.action-graph-scroll').getClientRects().length>0,'Graph not available');
      await clickText('Steps');
      document.querySelectorAll('.workflow-step')[0].click(); await pause();
      await addAction('Read JSON');
      await clickText('Save');
      const saved=(await cards())[0]; const parsed=saved.nodes.find(n=>n.type==='data.parse');const wait=saved.nodes.find(n=>n.type==='system.wait');
      expect(saved.edges.some(e=>e.from===parsed.id && e.to===wait.id),'Insert broke downstream order');
      const valueNode=saved.nodes.find(n=>n.type==='data.value');
      document.querySelector('[aria-label="Step 1: Value"]').click(); await pause();
      await fill('textarea[aria-label="Value"]','{');
      document.querySelector('[aria-label="Show Value on card"]').click(); await pause();
      await clickText('Save');
      expect((await cards())[0].inputs.some(input=>input.draft==='{'),'Exposing a field lost unfinished text');
      document.querySelector('[aria-label="Show Value on card"]').click(); await pause();
      await clickText('Save');
      expect((await cards())[0].nodes.find(node=>node.id===valueNode.id).drafts.value==='{','Hiding a card input lost unfinished text');
      await fill('textarea[aria-label="Value"]','{"ok":true}');
      await addAction('Open websites');
      await clickText('Save');
      expect((await cards())[0].inputs.some(input=>input.label==='Websites' && input.value.length===0),'Empty website input failed to save');
      await clickText('Save & run');
      expect(document.querySelector('.action-readiness').textContent.includes('Add a website'),'Empty website input not explained before run');
      document.querySelector('[aria-label="Close readiness"]').click(); await pause();
      await clickText('Reference');
    })()`)
    window.setSize(1281, 900)
    await new Promise((resolve) => setTimeout(resolve, 150))
    await fs.promises.writeFile(
      path.join(output, 'editor.png'),
      (await window.webContents.capturePage()).toPNG(),
    )
    await evaluate(
      `(async()=>{ await clickText('＋ Add step'); await waitFor(()=>document.querySelector('dialog[open]')); await fill('[aria-label="Find an action"]','Web request'); expect(document.querySelector('.action-library-preview').textContent.includes('State changes'),'Library docs missing'); })()`,
    )
    await fs.promises.writeFile(
      path.join(output, 'library.png'),
      (await window.webContents.capturePage()).toPNG(),
    )
    window.setSize(640, 760)
    await new Promise((resolve) => setTimeout(resolve, 150))
    await evaluate(
      `expect(document.documentElement.scrollWidth<=innerWidth,'Narrow library overflows viewport')`,
    )
    await fs.promises.writeFile(
      path.join(output, 'library-narrow.png'),
      (await window.webContents.capturePage()).toPNG(),
    )
    await evaluate(
      `(async()=>{ await fill('[aria-label="Find an action"]','nothingmatches');expect(!document.querySelector('.action-library footer .primary') || document.querySelector('.action-library footer .primary').disabled,'Empty search can add a step'); await clickText('Clear filters'); })()`,
    )
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await evaluate(`waitFor(()=>!document.querySelector('dialog[open]'))`)
    if (errors.length) throw new Error(errors.join('\n'))
    console.log(
      'PASS: draft save/reopen/repair/run, stable feedback, library reference/search/Escape, graph switching, insertion, narrow layout.',
    )
    console.log(`Screenshots: ${output}`)
    app.exit(0)
  } catch (error) {
    console.error(error)
    await fs.promises.writeFile(
      path.join(output, 'failure.png'),
      (await window.webContents.capturePage()).toPNG(),
    )
    app.exit(1)
  }
}

;(process.argv.includes('--electron') ? run() : prepare()).catch((error) => {
  console.error(error)
  if (process.argv.includes('--electron')) require('electron').app.exit(1)
  else process.exitCode = 1
})
