const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const { randomBytes, timingSafeEqual } = require('node:crypto')
const { WindowsDriver } = require('./computer')
const { VM_PORT, VM_TOKEN } = require('./vm-connection')

const ACTIONS = new Set(['screenshot', 'click', 'type', 'key', 'scroll', 'drag'])
const MAX_REQUEST_LENGTH = 128 * 1024

function createVmGuest(token, createDriver = () => new WindowsDriver()) {
  if (!VM_TOKEN.test(token)) throw new Error('Invalid VM pairing token.')
  const secret = Buffer.from(token, 'hex')
  let owner = null
  return net.createServer((socket) => {
    const controller = new AbortController()
    let buffer = ''
    let driver
    let pending
    let observed = false
    const reply = (result) => socket.write(`${JSON.stringify(result)}\n`)
    const end = (error) => socket.end(`${JSON.stringify({ error })}\n`)
    socket.setEncoding('utf8')
    socket.setTimeout(5000, () => socket.destroy())
    socket.on('error', () => socket.destroy())
    socket.on('close', async () => {
      if (owner !== socket) return
      controller.abort()
      await pending
      driver.dispose()
      owner = null
    })
    socket.on('data', (chunk) => {
      buffer += chunk
      if (pending || buffer.length > MAX_REQUEST_LENGTH) return socket.destroy()
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      if (newline !== buffer.length - 1) return socket.destroy()
      let message
      try {
        message = JSON.parse(buffer)
      } catch {
        return end('Invalid VM desktop request.')
      }
      buffer = ''
      const provided = message?.token
      if (
        typeof provided !== 'string' ||
        !VM_TOKEN.test(provided) ||
        !timingSafeEqual(secret, Buffer.from(provided, 'hex'))
      )
        return end('The VM rejected the pairing token.')
      const request = message.request
      if (!ACTIONS.has(request?.action)) return end('Invalid VM desktop action.')
      if (!observed && request.action !== 'screenshot')
        return end('Take a screenshot on this VM connection before sending input.')
      if (owner && owner !== socket) return end('The VM desktop is already in use.')
      if (!driver) {
        driver = createDriver()
        owner = socket
        socket.setTimeout(5 * 60 * 1000)
      }
      pending = (async () => {
        try {
          const result = await driver.call(request, controller.signal)
          if (request.action === 'screenshot') observed = true
          if (!socket.destroyed) reply(result)
        } catch (error) {
          if (!socket.destroyed) reply({ error: error.message })
        }
      })().finally(() => {
        pending = null
      })
    })
  })
}

function guestToken() {
  const directory = path.join(process.env.LOCALAPPDATA, 'Sisyphus')
  const file = path.join(directory, 'computer-vm-token')
  fs.mkdirSync(directory, { recursive: true })
  try {
    fs.writeFileSync(file, randomBytes(32).toString('hex'), { flag: 'wx' })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  return fs.readFileSync(file, 'utf8').trim()
}

if (require.main === module) {
  if (process.platform !== 'win32') throw new Error('Run this helper inside the Windows VM.')
  const token = guestToken()
  if (process.argv.includes('--show-token')) {
    console.log(token)
  } else {
    const server = createVmGuest(token)
    const sockets = new Set()
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    process.once('SIGINT', () => {
      server.close()
      for (const socket of sockets) socket.destroy()
    })
    server.listen(VM_PORT, '127.0.0.1', () => {
      console.log('VM desktop helper is ready. Keep this window open.')
    })
  }
}

module.exports = { createVmGuest }
