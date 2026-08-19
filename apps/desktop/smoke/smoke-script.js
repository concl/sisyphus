// Headless smoke test script, executed in the renderer via
// webContents.executeJavaScript (see the --smoke handler in ../main.js).
// It drives the real UI like a user and returns a JSON string with results.
(async () => {
  const waitFor = (sel, ms = 8000) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (document.querySelector(sel)) { clearInterval(iv); resolve(true); }
      else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('timeout waiting for ' + sel)); }
    }, 50);
  });

  await waitFor('[data-page]');
  await waitFor('[data-testid="terminal-page"]');

  const backends = await window.terminals.listBackends();

  // Icons: every sidebar page renders its own inline SVG — extensions own
  // their icons, there is no app-level sprite.
  const sidebarIcons = [...document.querySelectorAll('[data-page] svg')].map((s) => s.innerHTML.trim());
  const sidebarIconCount = sidebarIcons.length;
  const iconsResolve = sidebarIconCount >= 4 && sidebarIcons.every((h) => h.length > 0);

  // Open the Terminal page the way a user would: creates the first tab + shell.
  document.querySelector('[data-page="terminal"]').click();
  await waitFor('[data-testid="terminal-tab"]');

  const uiReady =
    document.querySelectorAll('[data-page]').length >= 4 &&
    document.querySelectorAll('[data-testid="terminal-tab"]').length === 1 &&
    !!document.querySelector('.xterm') &&
    !!document.querySelector('[aria-haspopup="menu"]');

  const res = await window.terminals.spawn({ ptyId: 'smoke-1', backendId: backends.defaultId, cols: 80, rows: 24 });
  const output = await new Promise((resolve) => {
    const off = window.terminals.onData((d) => {
      if (d.ptyId !== 'smoke-1') return;
      if (d.data.includes('SMOKE_OK')) { off(); resolve('SMOKE_OK'); }
    });
    window.terminals.write('smoke-1', 'echo SMOKE_OK; exit\\r');
    setTimeout(() => { off(); resolve('TIMEOUT'); }, 8000);
  });
  window.terminals.kill('smoke-1');

  // Close the first tab; a fresh one should be auto-created.
  const countBeforeClose = document.querySelectorAll('[data-testid="terminal-tab"]').length;
  const closeBtn = document.querySelector('[data-testid="terminal-tab-close"]');
  closeBtn && closeBtn.click();
  await new Promise((r) => setTimeout(r, 400));
  const tabsAfterClose = document.querySelectorAll('[data-testid="terminal-tab"]').length;
  const tabLabels = [...document.querySelectorAll('[data-testid="terminal-tab-name"]')].map((e) => e.textContent);

  // Extension pages: the processes registry and the python-host API view.
  document.querySelector('[data-page="processes"]').click();
  await waitFor('[data-testid="processes-page"]');
  const processRows = document.querySelectorAll('[data-testid="process-row"]').length;
  document.querySelector('[data-page="api"]').click();
  await waitFor('[data-testid="api-page"]');
  let apiOk = false;
  try {
    await waitFor('[data-testid="api-info"]', 3000);
    apiOk = JSON.parse(document.querySelector('[data-testid="api-info"]').textContent).service === 'python-host';
  } catch {
    /* service may be down; apiOk stays false */
  }

  // Runtime extension: seeded from the bundled defaults into the
  // userData store, loaded over the sisyphus-ext:// protocol at
  // startup, and registered into the sidebar at runtime.
  await waitFor('[data-page="runtime-sample"]');
  const runtimePageCount = document.querySelectorAll('[data-page]').length;
  document.querySelector('[data-page="runtime-sample"]').click();
  await waitFor('[data-testid="runtime-sample"]');
  const runtimeSampleText = document.querySelector('[data-testid="runtime-sample"]').textContent;

  // The runtime extension's own icon (icon.svg, fetched over sisyphus-ext://)
  // must have been injected into its sidebar entry by the host.
  const runtimeIcon = document.querySelector('[data-page="runtime-sample"] svg');
  const runtimeIconResolves = !!runtimeIcon && runtimeIcon.innerHTML.trim().length > 0;

  // Managed services: the python-host process + its HTTP API.
  const serviceStatus = await window.services.status();
  const serviceInfo = serviceStatus.running ? await window.services.call('/api/info') : null;
  const processes = await window.processes.list();

  // Scoped data storage: roundtrip through userData/storage.
  const storageOk = await window.sisyphus.storage.set('app', 'smoke', '1')
    .then(() => window.sisyphus.storage.get('app', 'smoke'))
    .then((v) => v === '1');

  return JSON.stringify({ defaultId: backends.defaultId, sidebarIconCount, iconsResolve, uiReady, countBeforeClose, tabsAfterClose, tabLabels, spawnOk: res.ok, output, processRows, apiOk, runtimePageCount, runtimeSampleText, runtimeIconResolves, serviceStatus, serviceInfo, processes, storageOk });
})()
