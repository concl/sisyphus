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
// Budgets a reply runs under. These used to be constants inside chat-service.js,
// which left a slow server or an over-eager model with no way to be tuned. They
// are settings now, and the defaults impose no limits at all: a reply works
// until it is done, and only the user stopping it or the provider failing ends
// it. Every budget accepts 0 for "no limit", so a limit is always something the
// user asked for rather than something they have to discover.
const DEFAULT_LIMITS = {
  maxSteps: 0,
  maxRetries: 1,
  firstChunkSeconds: 0,
  chunkSeconds: 0,
  toolSeconds: 0,
}
// Bounded so a typo cannot switch a budget to something absurd: the ceilings are
// generous (a day for one tool call) while 0 stays the way to say "no limit".
const limitsSchema = z
  .object({
    maxSteps: z.number().int().min(0).max(1000),
    maxRetries: z.number().int().min(0).max(10),
    firstChunkSeconds: z.number().int().min(0).max(3600),
    chunkSeconds: z.number().int().min(0).max(3600),
    toolSeconds: z.number().int().min(0).max(86400),
  })
  .strict()
// A stored value that no longer validates falls back to its default one field at
// a time, so a hand-edited file cannot leave the app without limits at all.
function readLimits(value) {
  const input = value && typeof value === 'object' ? value : {}
  const limits = { ...DEFAULT_LIMITS }
  for (const key of Object.keys(DEFAULT_LIMITS)) {
    const field = limitsSchema.shape[key].safeParse(input[key] ?? DEFAULT_LIMITS[key])
    limits[key] = field.success ? field.data : DEFAULT_LIMITS[key]
  }
  return limits
}
const settingsSchema = z
  .object({
    baseURL: z.string().max(2000).transform(validateBaseURL),
    model: z.string().trim().max(200),
    systemPrompt: z.string().trim().min(1).max(20000),
    access: z.enum(['none', 'read', 'write']),
    limits: limitsSchema,
    // `get()` reports the defaults next to the saved values so a form can offer
    // a restore button; saving that object back must not fail on it.
    defaultLimits: z.unknown().optional(),
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
    const { limits, ...rest } = saved
    return {
      baseURL: 'https://api.openai.com/v1',
      model: '',
      systemPrompt: DEFAULT_PROMPT,
      access: 'none',
      ...rest,
      limits: readLimits(limits),
      hasApiKey: this.secrets.has(),
      defaultSystemPrompt: DEFAULT_PROMPT,
      defaultLimits: { ...DEFAULT_LIMITS },
    }
  }
  save(input) {
    const previous = this.get()
    // A caller that does not send limits (an older form, a partial update)
    // keeps the stored ones instead of resetting them to the defaults.
    const limits = input?.limits === undefined ? previous.limits : limitsSchema.parse(input.limits)
    const { apiKey, clearApiKey, defaultLimits, ...settings } = settingsSchema.parse({
      ...input,
      limits,
    })
    if (apiKey?.trim()) this.secrets.write(apiKey.trim())
    else if (clearApiKey || settings.baseURL !== previous.baseURL) this.secrets.clear()
    this.storage.set('chat.config', 'provider.v1', settings)
    return this.get()
  }
  resolve() {
    const settings = this.get()
    if (!settings.model)
      throw new Error('Choose a model in Settings > Chat before sending a message.')
    return {
      ...settings,
      limits: limitsSchema.parse(settings.limits),
      baseURL: validateBaseURL(settings.baseURL),
      apiKey: this.secrets.read(),
    }
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
module.exports = {
  ChatConfig,
  EncryptedKeyStore,
  validateBaseURL,
  readLimits,
  DEFAULT_PROMPT,
  DEFAULT_LIMITS,
}
