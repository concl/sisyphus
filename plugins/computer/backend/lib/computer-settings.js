const { VM_HOST, VM_TOKEN } = require('./vm-connection')

const SCOPE = 'computer'
const KEY = 'desktop.v1'

function computerSettings(storage, safeStorage) {
  const read = () => storage.get(SCOPE, KEY) ?? {}
  const snapshot = ({ enabled, host, encryptedToken }) => ({
    enabled: enabled === true,
    host: typeof host === 'string' ? host : '',
    hasToken: typeof encryptedToken === 'string' && Boolean(encryptedToken),
  })
  function requireEncryption() {
    if (
      !safeStorage?.isEncryptionAvailable() ||
      safeStorage.getSelectedStorageBackend?.() === 'basic_text'
    )
      throw new Error('Unlock your system credential store to use the isolated desktop.')
  }
  return {
    get: () => snapshot(read()),
    save({ enabled, host, token }) {
      if (typeof enabled !== 'boolean' || typeof host !== 'string' || typeof token !== 'string')
        throw new Error('Invalid desktop settings.')
      host = host.trim()
      token = token.trim()
      if ((enabled || host) && !VM_HOST.test(host))
        throw new Error('Enter the VM’s SSH host name or config alias.')
      const existing = read()
      let encryptedToken = host === existing.host ? existing.encryptedToken : undefined
      if (token) {
        if (!VM_TOKEN.test(token)) throw new Error('Enter the pairing token shown in the VM.')
        requireEncryption()
        encryptedToken = safeStorage.encryptString(token).toString('base64')
      }
      if (enabled && !encryptedToken) throw new Error('Enter the pairing token shown in the VM.')
      const saved = { enabled, host, encryptedToken }
      storage.set(SCOPE, KEY, saved)
      return snapshot(saved)
    },
    connection() {
      const { enabled, host, encryptedToken } = read()
      if (enabled !== true) return null
      requireEncryption()
      let token
      try {
        token = safeStorage.decryptString(Buffer.from(encryptedToken, 'base64'))
      } catch {
        throw new Error('Enter the VM pairing token again in Computer use settings.')
      }
      if (typeof host !== 'string' || !VM_HOST.test(host) || !VM_TOKEN.test(token))
        throw new Error('Complete the VM connection in Computer use settings.')
      return { host, token }
    },
  }
}

module.exports = { computerSettings }
