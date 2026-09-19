const fs = require('node:fs')
const path = require('node:path')
const { z } = require('zod')
const DEFAULT_PROMPT = fs
  .readFileSync(path.join(__dirname, '..', 'prompts', 'chat-system.md'), 'utf8')
  .trim()

function validateBaseURL(value) {
  const url = new URL(value)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
  )
    throw new Error('Use an HTTPS API URL, or HTTP on localhost. Put the API key in its own field.')
  return url.toString().replace(/\/$/, '')
}
const settingsSchema = z
  .object({
    baseURL: z.string().max(2000).transform(validateBaseURL),
    model: z.string().trim().max(200),
    systemPrompt: z.string().trim().min(1).max(20000),
    access: z.enum(['none', 'read', 'write']),
    apiKey: z.string().max(4096).optional(),
    clearApiKey: z.boolean().optional(),
  })
  .strict()

class ChatConfig {
  constructor(storage, secrets) {
    this.storage = storage
    this.secrets = secrets
  }
  get() {
    const saved = this.storage.get('chat.config', 'provider.v1') || {}
    return {
      baseURL: 'https://api.openai.com/v1',
      model: '',
      systemPrompt: DEFAULT_PROMPT,
      access: 'none',
      ...saved,
      hasApiKey: this.secrets.has(),
      defaultSystemPrompt: DEFAULT_PROMPT,
    }
  }
  save(input) {
    const { apiKey, clearApiKey, ...settings } = settingsSchema.parse(input)
    const previous = this.get()
    if (apiKey?.trim()) this.secrets.write(apiKey.trim())
    else if (clearApiKey || settings.baseURL !== previous.baseURL) this.secrets.clear()
    this.storage.set('chat.config', 'provider.v1', settings)
    return this.get()
  }
  resolve() {
    const settings = this.get()
    if (!settings.model)
      throw new Error('Choose a model in Settings → Chat before sending a message.')
    return { ...settings, baseURL: validateBaseURL(settings.baseURL), apiKey: this.secrets.read() }
  }
}

class EncryptedKeyStore {
  constructor(file, safeStorage) {
    this.file = file
    this.safeStorage = safeStorage
  }
  has() {
    return fs.existsSync(this.file)
  }
  read() {
    if (!this.has()) return undefined
    if (!this.safeStorage.isEncryptionAvailable())
      throw new Error('The operating system credential store is unavailable.')
    return this.safeStorage.decryptString(fs.readFileSync(this.file))
  }
  write(key) {
    if (
      !this.safeStorage.isEncryptionAvailable() ||
      this.safeStorage.getSelectedStorageBackend?.() === 'basic_text'
    )
      throw new Error(
        'Secure credential storage is unavailable. Configure your OS keyring before saving an API key.',
      )
    const encrypted = this.safeStorage.encryptString(key)
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(`${this.file}.tmp`, encrypted, { mode: 0o600 })
    fs.renameSync(`${this.file}.tmp`, this.file)
  }
  clear() {
    if (this.has()) fs.unlinkSync(this.file)
  }
}
module.exports = { ChatConfig, EncryptedKeyStore, validateBaseURL, DEFAULT_PROMPT }
