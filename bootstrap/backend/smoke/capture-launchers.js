const fs = require('node:fs')
const path = require('node:path')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Optional visual fixtures run only inside the smoke test's disposable profile.
module.exports = async function captureLaunchers(window, directory) {
  fs.mkdirSync(directory, { recursive: true })
  const wc = window.webContents
  await wc.executeJavaScript(`(async () => {
    const locations = await window.sisyphus.call('data.locations');
    await window.sisyphus.call('contexts.saveAction', {
      name: 'Sisyphus',
      action: { integration: 'vscode', folders: [locations.find(item => item.id === 'all').path], profile: 'Development', window: 'new' }
    });
    await window.sisyphus.call('contexts.saveAction', {
      name: 'Reference library',
      action: { integration: 'browser', urls: ['https://developer.mozilla.org/', 'https://code.visualstudio.com/docs'] }
    });
    await window.sisyphus.call('appearance.set', { theme: 'light' });
    document.querySelector('[aria-label="Open VS Code"]').click();
  })()`)
  const capture = async (name) => {
    await delay(350)
    fs.writeFileSync(path.join(directory, `${name}.png`), (await wc.capturePage()).toPNG())
  }
  await capture('vscode-list')
  await wc.executeJavaScript(`document.querySelector('[aria-label="Edit Sisyphus"]').click()`)
  await capture('vscode-editor')
  await wc.executeJavaScript(`document.querySelector('[aria-label="Open Browser Tabs"]').click()`)
  await capture('browser-list')
  await wc.executeJavaScript(`(async () => {
    await window.sisyphus.call('appearance.set', { theme: 'dark' });
    document.querySelector('[aria-label="Edit Reference library"]').click();
  })()`)
  window.setSize(900, 700)
  await capture('browser-editor-dark-narrow')
}
