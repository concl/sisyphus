const fs = require('node:fs')
const path = require('node:path')
const { z } = require('zod')
const { ChatConfig, validateBaseURL, readLimits, settingsSchema } = require('./chat-config')

const modelName = z.string().trim().min(1).max(200)
const documentSchema = z
  .object({
    providers: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(100),
            baseURL: z.string().min(1).max(2000),
            apiKey: z.string().max(4096).optional(),
            models: z.array(modelName).max(1000),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()

function parseProviders(text) {
  let input
  try {
    input = JSON.parse(text)
  } catch {
    // JSON parser messages can contain fragments of an API key.
    throw new Error('Provider configuration must be valid JSON.')
  }
  const result = documentSchema.safeParse(input)
  if (!result.success)
    throw new Error(
      `Invalid provider configuration at ${result.error.issues[0].path.join('.') || 'root'}. Use providers with id, baseURL, optional apiKey, and models.`,
    )
  const ids = new Set()
  for (const provider of result.data.providers) {
    provider.baseURL = validateBaseURL(provider.baseURL)
    if (ids.has(provider.id)) throw new Error('Provider IDs must be unique.')
    ids.add(provider.id)
    if (new Set(provider.models).size !== provider.models.length)
      throw new Error('Model names must be unique within each provider.')
  }
  return result.data
}

/** Provider keys stay in this file; ordinary config responses contain only metadata. */
class ProviderChatConfig extends ChatConfig {
  constructor(storage, secrets, file) {
    super(storage, secrets)
    this.file = file
    if (!fs.existsSync(file)) {
      const previous = super.get()
      this.write({
        providers: [
          {
            id: 'default',
            baseURL: previous.baseURL,
            models: previous.model ? [previous.model] : [],
          },
        ],
      })
      // Bind the existing encrypted key to its original provider and endpoint.
      // Never decrypt it into the JSON document.
      storage.set('chat.config', 'legacy-key.v1', {
        id: 'default',
        baseURL: validateBaseURL(previous.baseURL),
      })
    }
    try {
      this.initializeSelection(this.read())
    } catch {
      // Keep Settings available to repair a malformed file; get() reports it.
    }
  }
  write(document) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(`${this.file}.tmp`, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(`${this.file}.tmp`, this.file)
  }
  document() {
    return { path: this.file, text: fs.readFileSync(this.file, 'utf8') }
  }
  read() {
    return parseProviders(this.document().text).providers
  }
  usesLegacyKey(provider) {
    const legacy = this.storage.get('chat.config', 'legacy-key.v1')
    return (
      provider.apiKey === undefined &&
      legacy?.id === provider.id &&
      legacy.baseURL === provider.baseURL
    )
  }
  selection(providers) {
    const saved = this.storage.get('chat.config', 'selection.v1')
    const provider = saved
      ? providers.find((item) => item.id === saved.provider && item.models.includes(saved.model))
      : providers.find((item) => item.models.length)
    return { provider, model: provider ? (saved?.model ?? provider.models[0]) : '' }
  }
  initializeSelection(providers) {
    if (this.storage.get('chat.config', 'selection.v1')) return
    const { provider, model } = this.selection(providers)
    if (provider) this.storage.set('chat.config', 'selection.v1', { provider: provider.id, model })
  }
  get() {
    const settings = super.get()
    let providers = [],
      providerError = ''
    try {
      providers = this.read()
    } catch (error) {
      providerError = error.message
    }
    const { provider, model } = this.selection(providers)
    return {
      ...settings,
      baseURL: provider?.baseURL ?? '',
      model,
      provider: provider?.id ?? '',
      providerConfigPath: this.file,
      providerError,
      providers: providers.map((item) => ({
        id: item.id,
        baseURL: item.baseURL,
        models: item.models,
      })),
      hasApiKey: Boolean(
        provider &&
        (provider.apiKey?.trim() || (this.usesLegacyKey(provider) && this.secrets.has())),
      ),
    }
  }
  saveProviders({ text }) {
    if (typeof text !== 'string' || text.length > 2_000_000)
      throw new Error('Provide a provider JSON document smaller than 2 MB.')
    const document = parseProviders(text)
    this.write(document)
    this.initializeSelection(document.providers)
    return this.get()
  }
  select(input) {
    const selected = z.object({ provider: modelName, model: modelName }).strict().parse(input)
    const provider = this.read().find((item) => item.id === selected.provider)
    if (!provider?.models.includes(selected.model))
      throw new Error('That model is no longer configured. Reload models and choose again.')
    this.storage.set('chat.config', 'selection.v1', selected)
    return this.get()
  }
  save(input) {
    // General settings cannot overwrite provider selection or credentials.
    const previous = super.get()
    const settings = settingsSchema
      .pick({ systemPrompt: true, access: true, limits: true })
      .parse({ ...input, limits: input?.limits ?? previous.limits })
    this.storage.set('chat.config', 'provider.v1', {
      baseURL: previous.baseURL,
      model: previous.model,
      ...settings,
    })
    return this.get()
  }
  resolve() {
    const { provider, model } = this.selection(this.read())
    if (!provider) throw new Error('Choose a configured model in Chat before sending a message.')
    const settings = super.get()
    return {
      ...settings,
      baseURL: provider.baseURL,
      model,
      limits: readLimits(settings.limits),
      apiKey:
        provider.apiKey?.trim() || (this.usesLegacyKey(provider) ? this.secrets.read() : undefined),
    }
  }
}

module.exports = { ProviderChatConfig, parseProviders }
