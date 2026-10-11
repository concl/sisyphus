const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const backend = createRequire(path.join(root, 'bootstrap/backend/package.json'))
const output = path.join(root, 'build/notes-smoke')
async function prepare() {
  fs.mkdirSync(output, { recursive: true })
  await backend('esbuild').build({
    stdin: {
      contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {NotesPanel} from './plugins/notes/frontend/panel';
      import {NotesStore} from './plugins/notes/frontend/store';
      import './plugins/notes/frontend/notes.css'; import './plugins/theme/frontend/theme.css';
      import './bootstrap/frontend/src/index.css';
      import './plugins/workspace/frontend/workspace.css';
      const {ipcRenderer}=window.require('electron');
      const desktop={call:(name,input)=>ipcRenderer.invoke('test.call',name,input)};
      window.store=new NotesStore(desktop); window.store.refresh();
      createRoot(document.getElementById('root')).render(<NotesPanel store={window.store}/>);
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
    '<!doctype html><html><head><link rel="stylesheet" href="harness.css"><style>html,body,#root{height:100%;margin:0}body{font-family:system-ui}</style></head><body><div id="root"></div><script src="harness.js"></script></body></html>',
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
  const profile = fs.mkdtempSync(path.join(output, 'profile-'))
  app.setPath('userData', profile)
  await app.whenReady()
  const { Vault } = require('../plugins/notes/backend/vault.js')
  const vault = new Vault(profile)
  const existing = path.join(profile, 'Existing project')
  fs.mkdirSync(path.join(existing, 'Projects'), { recursive: true })
  fs.writeFileSync(
    path.join(existing, 'Welcome.md'),
    '# Project notes\n\nReview the API changes before Friday. #review\n\n[[Projects/Next steps|Next steps]]\n\n- Check the migration\n- Update the schema\n',
  )
  fs.writeFileSync(
    path.join(existing, 'Projects/Next steps.md'),
    '# Next steps\n\nSee [[Welcome]].\n\n> Keep the current file format.\n',
  )
  ipcMain.handle('test.call', (_, name, input) => {
    if (name === 'notes.chooseParent') return profile
    if (name === 'notes.chooseFolder') return vault.setFolder(existing)
    if (name === 'notes.setFolder') return vault.setFolder(input.folder)
    const method = name.replace('notes.', '')
    if (typeof vault[method] !== 'function') throw new Error(`Unknown method ${method}`)
    return vault[method](input)
  })
  const window = new BrowserWindow({
    show: false,
    width: 1200,
    height: 820,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
      offscreen: true,
    },
  })
  const errors = []
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(details.message)
  })
  await window.loadFile(path.join(output, 'index.html'))
  const evaluate = async (code) => {
    const result = await window.webContents.executeJavaScript(
      `(async()=>{try{return await eval(${JSON.stringify(code)})}catch(error){return {testError:error.stack}}})()`,
      true,
    )
    if (result?.testError) throw new Error(result.testError)
    return result
  }
  try {
    await evaluate(`
      window.pause=()=>new Promise(r=>setTimeout(r,80));
      window.expect=(ok,text)=>{if(!ok)throw new Error(text)};
      window.waitFor=async fn=>{for(let i=0;i<100;i++){if(fn())return;await pause()}throw new Error('Timed out: '+fn)};
      window.button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
      window.click=async text=>{expect(button(text),'Missing button: '+text);button(text).click();await pause()};
      window.fill=async(selector,value)=>{const el=document.querySelector(selector);expect(el,'Missing '+selector);Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));await pause()};void 0;
    `)
    await evaluate(String.raw`(async()=>{
      await pause();
      expect(store.getSnapshot().folder==='','A project was created implicitly');
      expect(document.querySelector('.notes-empty').textContent.includes('Open a project folder'),'Missing folder setup');
      await click('New project');await fill('#notes-path','Project A');
      expect(button('Create project').disabled,'Create enabled without a location');
      await click('Choose folder');await click('Create project');
      await waitFor(()=>store.getSnapshot().folder.endsWith('Project A'));
      document.querySelector('[aria-label="New folder"]').click();await pause();
      await fill('#notes-path','Research');await click('Create folder');
      await waitFor(()=>store.getSnapshot().folders.includes('Research'));
      document.querySelector('[aria-label="Create a note"]').click();await pause();
      expect(document.querySelector('#notes-path').value==='Research/','New note ignores selected folder');
      await fill('#notes-path','Research/Experiment');await click('Create note');
      await waitFor(()=>store.getSnapshot().document?.path==='Research/Experiment.md');
      expect(store.getSnapshot().content==='','New note inserts unsolicited content');
      await pause();expect(document.activeElement===document.querySelector('[aria-label="Markdown editor"]'),'New note does not focus the editor');
      await fill('[aria-label="Markdown editor"]','temporary');await fill('[aria-label="Markdown editor"]','');
      expect(store.getSnapshot().status==='Saved','Reverting an edit leaves an unsaved marker');
      await fill('[aria-label="Markdown editor"]','# Experiment\n\nUnsaved project switch.');
      await click('Open folder');
      await waitFor(()=>store.getSnapshot().notes.length===2);
      await store.open('Welcome.md'); await pause();
      expect(!document.querySelector('.notes-preview'),'Edit should be the default');
      await click('Split');
      expect(document.querySelector('.notes-preview h1').textContent==='Project notes','Markdown heading missing');
      const wiki=document.querySelector('.notes-preview a');expect(wiki.textContent==='Next steps','Wiki alias missing');wiki.click();await waitFor(()=>store.getSnapshot().document.path==='Projects/Next steps.md');
      expect(document.querySelector('.notes-links').textContent.includes('Backlinks (1)'),'Backlink missing');
      await fill('[aria-label="Markdown editor"]','# Next steps\n\nSaved through the editor. #work [[Welcome]]');
      await waitFor(()=>store.getSnapshot().status==='Saved');
      await store.open('Welcome.md'); await store.open('Projects/Next steps.md'); await pause();
      expect(document.querySelector('textarea').value.includes('Saved through'),'Autosave lost text');
      await fill('[aria-label="Search notes"]','API changes');
      await waitFor(()=>document.querySelectorAll('.notes-search-result').length===1);
      await fill('[aria-label="Search notes"]','');
      document.querySelector('[aria-label="Create a note"]').click();await pause();
      await fill('#notes-path','Research/Experiment'); await click('Create note');
      await waitFor(()=>store.getSnapshot().document?.path==='Research/Experiment.md');
      await fill('[aria-label="Markdown editor"]','# Experiment\n\n[[Welcome]]\n\n| Item | Status |\n| --- | --- |\n| Markdown | Ready |');
      await store.save(); await store.refresh(); await pause();
      await click('Read');expect(!document.querySelector('textarea'),'Read mode has editor');await click('Split');
    })()`)
    // A concurrent edit must leave both disk content and the user's draft intact.
    fs.writeFileSync(path.join(vault.folder, 'Research/Experiment.md'), '# External edit')
    await evaluate(String.raw`(async()=>{
      await fill('[aria-label="Markdown editor"]','# My unsaved draft');
      await pause();try{await store.save();throw new Error('Conflict allowed')}catch(e){expect(String(e).includes('changed on disk'),'Wrong conflict error')}
      expect(store.getSnapshot().content==='# My unsaved draft','Conflict lost draft');
      store.report(new Error('File changed on disk'));
      await pause();await click('Save copy…');await fill('#notes-path','Research/Recovered');await click('Save copy');
      await waitFor(()=>store.getSnapshot().document.path==='Research/Recovered.md');
      expect(store.getSnapshot().content==='# My unsaved draft','Save copy lost draft');
      await store.open('Research/Experiment.md');await pause();expect(store.getSnapshot().content==='# External edit','External version changed');
      await store.open('Welcome.md');await pause();
    })()`)
    if (
      fs.readFileSync(path.join(vault.folder, 'Research/Experiment.md'), 'utf8') !==
      '# External edit'
    )
      throw new Error('External edit overwritten')
    if (
      fs.readFileSync(path.join(profile, 'Project A/Research/Experiment.md'), 'utf8') !==
      '# Experiment\n\nUnsaved project switch.'
    )
      throw new Error('Switching projects lost the draft')
    await evaluate(`(async()=>{
      const project=document.querySelector('[aria-label="Project"]');project.value=[...project.options].find(option=>option.text==='Project A').value;project.dispatchEvent(new Event('change',{bubbles:true}));
      await waitFor(()=>store.getSnapshot().document?.path==='Research/Experiment.md');
      expect(store.getSnapshot().content.includes('Unsaved project switch'),'Last note was not restored');
      await click('Open folder');await waitFor(()=>store.getSnapshot().document?.path==='Welcome.md');
      await click('Edit');
      expect(getComputedStyle(document.querySelector('.notes-project-actions button')).borderRadius==='0px','Rounded control remains');
      const folders=[...document.querySelectorAll('.notes-tree > .notes-tree-folder')];
      const first=folders[0], next=folders[1];
      expect(Math.abs(next.getBoundingClientRect().top-first.getBoundingClientRect().bottom)<1,'Extra spacing between folder groups');
      const heading=first.querySelector('summary'), child=first.querySelector('.notes-tree-file');
      expect(Math.abs(child.getBoundingClientRect().top-heading.getBoundingClientRect().bottom)<1,'Extra spacing below folder heading');
      const rootFile=document.querySelector('.notes-tree > .notes-tree-file');
      expect(Math.abs(rootFile.querySelector('svg').getBoundingClientRect().left-heading.querySelector('svg').getBoundingClientRect().left)<1,'Folder and file icons do not align');
    })()`)
    await fs.promises.writeFile(
      path.join(output, 'notes.png'),
      (await window.webContents.capturePage()).toPNG(),
    )
    await evaluate(`document.documentElement.dataset.theme='dark'`)
    await new Promise((resolve) => setTimeout(resolve, 100))
    await fs.promises.writeFile(
      path.join(output, 'notes-dark.png'),
      (await window.webContents.capturePage()).toPNG(),
    )
    await evaluate(`document.documentElement.dataset.theme='light'`)
    window.setSize(480, 760)
    await new Promise((resolve) => setTimeout(resolve, 200))
    await evaluate(
      `expect(document.documentElement.scrollWidth<=innerWidth,'Narrow viewport overflow')`,
    )
    await evaluate(
      `(async()=>{document.querySelector('.notes-sidebar [aria-label="Hide files"]').click();await new Promise(resolve=>setTimeout(resolve,250));expect(document.querySelector('.notes-sidebar').getAttribute('aria-hidden')==='true','Sidebar did not collapse');expect(document.querySelector('.notes-sidebar').getBoundingClientRect().right<=1,'Collapsed sidebar covers editor')})()`,
    )
    await fs.promises.writeFile(
      path.join(output, 'notes-narrow.png'),
      (await window.webContents.capturePage()).toPNG(),
    )
    if (errors.length) throw new Error(errors.join('\n'))
    console.log(
      'PASS: explicit project setup, creation, folder tree, project switching with draft save and last-note restore, Markdown links, autosave, search, save-copy conflict recovery, square controls, light/dark/narrow layouts.',
    )
    app.exit(0)
  } catch (error) {
    console.error(error, errors)
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
