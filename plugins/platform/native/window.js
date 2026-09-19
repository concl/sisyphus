const { BrowserWindow, Menu, nativeTheme } = require('electron')
module.exports = ({ frontend, smoke, preload }) => ({
  id: 'desktop.window',
  inject: ['transport.v1', 'preferences.v1'],
  provide: ['window.v1'],
  apply(ctx) {
    Menu.setApplicationMenu(null)
    let window
    const colors = () =>
      nativeTheme.shouldUseDarkColors
        ? { color: '#171b24', symbolColor: '#dce2ef', height: 44 }
        : { color: '#ffffff', symbolColor: '#293047', height: 44 }
    const updateChrome = () => {
      if (!window || window.isDestroyed()) return
      window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#171b24' : '#f3f4f8')
      if (process.platform !== 'darwin') window.setTitleBarOverlay(colors())
    }
    nativeTheme.on('updated', updateChrome)
    ctx.effect(() => () => nativeTheme.removeListener('updated', updateChrome))
    const open = () => {
      if (window && !window.isDestroyed()) {
        window.focus()
        return window
      }
      window = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 850,
        minHeight: 560,
        title: 'Sisyphus',
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#171b24' : '#f3f4f8',
        titleBarStyle: 'hidden',
        ...(process.platform === 'darwin'
          ? { trafficLightPosition: { x: 14, y: 14 } }
          : { titleBarOverlay: colors() }),
        show: !smoke,
        webPreferences: {
          preload,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: !smoke,
          offscreen: smoke,
        },
      })
      const wc = window.webContents
      wc.setWindowOpenHandler(() => ({ action: 'deny' }))
      wc.on('will-navigate', (event) => event.preventDefault())
      wc.on('before-input-event', (_, input) => {
        if (
          input.type === 'keyDown' &&
          (input.key === 'F12' ||
            (input.key.toLowerCase() === 'i' && input.shift && (input.control || input.meta)))
        )
          wc.toggleDevTools()
      })
      if (process.env.VITE_DEV_SERVER_URL) window.loadURL(process.env.VITE_DEV_SERVER_URL)
      else window.loadFile(frontend)
      return window
    }
    ctx.effect(() => () => {
      if (window && !window.isDestroyed()) window.destroy()
    })
    ctx.provide('window.v1', { open })
  },
})
