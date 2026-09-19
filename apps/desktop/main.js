const { app } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const profile = require('./profile')
let runtime
let quitting = false
let smokeExitCode = 0
const smoke = process.argv.includes('--smoke')
if (process.env.SISYPHUS_USER_DATA) app.setPath('userData', process.env.SISYPHUS_USER_DATA)
else if (smoke)
  app.setPath('userData', fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sisyphus-smoke-')))
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app
    .whenReady()
    .then(async () => {
      const { Profile } = await import('@sisyphus/profile')
      runtime = new Profile()
      const frontend = app.isPackaged
        ? path.join(__dirname, 'frontend-dist', 'index.html')
        : path.join(__dirname, '..', 'frontend', 'dist', 'index.html')
      const hostDir = app.isPackaged
        ? path.join(process.resourcesPath, 'python-host')
        : path.join(__dirname, '..', '..', 'services', 'python-host')
      await runtime.mount(
        profile({ userData: app.getPath('userData'), hostDir, frontend, smoke }).map((plugin) => ({
          id: plugin.id,
          plugin,
        })),
      )
      const transport = runtime.get('transport.v1')
      transport.handle('runtime.list', () => runtime.list())
      transport.handle('runtime.enable', async ({ id, enabled }) => {
        if (
          !['desktop.terminal', 'desktop.python-host', 'desktop.files', 'desktop.shell'].includes(
            id,
          ) ||
          typeof enabled !== 'boolean'
        )
          throw new Error('Not a toggleable desktop plugin')
        await runtime.setEnabled(id, enabled)
        return runtime.list()
      })
      const modelFixture = smoke ? await require('./smoke/mock-model')() : null
      const window = runtime.get('window.v1').open()
      if (smoke) {
        const guard = setTimeout(() => {
          console.error('SMOKE_TIMEOUT')
          app.exit(1)
        }, 60000)
        window.webContents.once('did-finish-load', async () => {
          try {
            await window.webContents.executeJavaScript(
              `window.__smokeModelURL = ${JSON.stringify(modelFixture.baseURL)}`,
            )
            const result = await window.webContents.executeJavaScript(
              fs.readFileSync(path.join(__dirname, 'smoke', 'smoke-script.js'), 'utf8'),
            )
            Object.assign(result, await require('./smoke/verify-layout')(window))
            console.log('SMOKE_RESULT ' + JSON.stringify(result))
            if (process.env.SISYPHUS_SCREENSHOT)
              fs.writeFileSync(
                process.env.SISYPHUS_SCREENSHOT,
                (await window.webContents.capturePage()).toPNG(),
              )
            smokeExitCode = 0
          } catch (error) {
            console.error('SMOKE_ERROR', error)
            smokeExitCode = 1
          }
          clearTimeout(guard)
          // Exercise Cordis teardown before leaving the smoke process. Electron's
          // native shutdown sometimes aborts after offscreen PTY capture on Windows.
          await runtime.dispose()
          await modelFixture.close()
          runtime = undefined
          process.exit(smokeExitCode)
        })
      }
      app.on('activate', () => runtime.get('window.v1').open())
      app.on('second-instance', () => runtime.get('window.v1').open())
    })
    .catch((error) => {
      console.error(error)
      app.exit(1)
    })
  app.on('before-quit', (event) => {
    if (quitting || !runtime) return
    event.preventDefault()
    quitting = true
    runtime.dispose().finally(() => app.exit(smokeExitCode))
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
