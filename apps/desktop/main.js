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
      const { applyStates, writeState } = await import('@sisyphus/profile/preferences')
      runtime = new Profile()
      const frontend = app.isPackaged
        ? path.join(__dirname, 'frontend-dist', 'index.html')
        : path.join(__dirname, '..', 'frontend', 'dist', 'index.html')
      const hostDir = app.isPackaged
        ? path.join(process.resourcesPath, 'python-host')
        : path.join(__dirname, '..', '..', 'services', 'python-host')
      // The build of `packages/plugin-*` that this app carries. The native half
      // copies it into the user's plugins folder, so a shipped plugin is a file the
      // user can read and edit rather than something frozen into the app.
      const shippedPlugins = app.isPackaged
        ? path.join(process.resourcesPath, 'plugins')
        : path.join(__dirname, '..', '..', 'build', 'plugins')
      await runtime.mount(
        (await profile({
          userData: app.getPath('userData'),
          hostDir,
          frontend,
          smoke,
          runtime,
          shippedPlugins,
        })).map((plugin) => ({ id: plugin.id, plugin })),
      )
      const transport = runtime.get('transport.v1')
      const storage = runtime.get('storage.v1')
      transport.handle('runtime.list', () => runtime.list())
      // Anything the profile can compose can be switched at runtime, including a
      // plugin that arrived from the plugins folder. The services the workspace
      // itself is built on are the exception: switching those off helps nobody.
      const required = [
        'desktop.transport',
        'desktop.window',
        'desktop.storage',
        'desktop.preferences',
        'desktop.plugin-loader',
        'platform.workers',
      ]
      transport.handle('runtime.enable', async ({ id, enabled }) => {
        if (typeof enabled !== 'boolean') throw new Error('Expected enabled boolean')
        if (required.includes(id)) throw new Error(`${id} is required by the workspace.`)
        if (!runtime.list().some((plugin) => plugin.id === id))
          throw new Error(`Unknown plugin: ${id}`)
        await runtime.setEnabled(id, enabled)
        await writeState(storage, id, enabled)
        return runtime.list()
      })
      // A switch made in an earlier session is a decision, not a suggestion: it
      // applies before the window opens, so a disabled plugin never starts.
      await applyStates(runtime, storage)
      const modelFixture = smoke ? await require('./smoke/mock-model')() : null
      const window = runtime.get('window.v1').open()
      if (smoke) {
        // A smoke failure is often a plugin reporting something from inside the
        // window, so let those messages through to the log the run is read from.
        window.webContents.on('console-message', (event, level, message) => {
          const text = typeof event === 'object' && event?.message ? event.message : message
          if (text) console.log('RENDERER', text)
        })
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
            if (process.env.SISYPHUS_LAUNCHER_SCREENSHOTS)
              await require('./smoke/capture-launchers')(
                window,
                process.env.SISYPHUS_LAUNCHER_SCREENSHOTS,
              )
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
