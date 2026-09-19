;(async () => {
  const waitFor = async (predicate, label = 'a smoke condition', timeout = 20000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`Timed out waiting for ${label}`)
  }
  const assert = (value, message) => {
    if (!value) throw new Error(message)
  }
  await waitFor(
    () =>
      document.querySelector('.home-panel') &&
      document.querySelector('.terminal-host') &&
      document.querySelector('.python-panel') &&
      document.querySelector('.planner-panel'),
  )
  const bridge = window.sisyphus
  const runtime = await bridge.call('runtime.list')
  assert(
    runtime.every((plugin) => plugin.state === 'active'),
    JSON.stringify(runtime),
  )
  const { defaultId } = await bridge.call('terminal.backends')
  const id = crypto.randomUUID()
  let output = ''
  const off = bridge.on('terminal.data', (event) => {
    if (event.id === id) output += event.data
  })
  await bridge.call('terminal.spawn', { id, backendId: defaultId, cols: 80, rows: 24 })
  await bridge.call('terminal.write', { id, data: 'echo SISYPHUS_SMOKE_OK\r' })
  await waitFor(() => output.includes('SISYPHUS_SMOKE_OK'))
  await bridge.call('terminal.kill', { id })
  off()
  const servers = await bridge.call('python.start', { id: 'workspace-api' })
  assert(servers[0].state === 'running', JSON.stringify(servers))
  const info = await bridge.call('python.call', { id: 'workspace-api', path: '/api/info' })
  assert(info.service === 'python-host', JSON.stringify(info))
  await bridge.call('python.stop', { id: 'workspace-api' })
  try {
    const title = document.querySelector('.planner-add [aria-label="Title"]')
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    nativeSetter.call(title, 'Smoke task')
    title.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('.planner-add button[type="submit"]').click()
    await waitFor(async () =>
      (await bridge.call('storage.get', { scope: 'planner', key: 'document.v1' }))?.records?.some(
        (item) => item.title === 'Smoke task',
      ),
    )
  } catch (error) {
    throw new Error(`Planner smoke: ${error}`)
  }
  await bridge.call('runtime.enable', { id: 'desktop.python-host', enabled: false })
  const disabled = await bridge.call('runtime.list')
  assert(
    disabled.find((plugin) => plugin.id === 'desktop.python-host')?.state === 'disabled',
    'Provider did not unload',
  )
  await bridge.call('runtime.enable', { id: 'desktop.python-host', enabled: true })
  document.querySelector('.header-actions > button').click()
  await waitFor(() => document.querySelector('[role="switch"][aria-label="Home"]'))
  document.querySelector('[role="switch"][aria-label="Home"]').click()
  await waitFor(() => !document.querySelector('.home-panel'))
  document.querySelector('[role="switch"][aria-label="Home"]').click()
  await waitFor(() => document.querySelector('[aria-label="Open Home"]'))
  document.querySelector('[aria-label="Open Home"]').click()
  await waitFor(() => document.querySelector('.home-panel'))
  document.querySelector('[aria-label="Close plugins"]').click()
  try {
    document.querySelector('[aria-label="Saved layouts"]').click()
    await waitFor(() => document.querySelector('[aria-label="Layout name"]'))
    const layoutName = document.querySelector('[aria-label="Layout name"]')
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    nativeSetter.call(layoutName, 'Smoke layout')
    layoutName.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('.layout-menu button[type="submit"]').click()
    await waitFor(
      async () =>
        !!(await bridge.call('storage.get', { scope: 'ui.workspace', key: 'saved-layouts.v1' }))?.[
          'Smoke layout'
        ],
    )
  } catch (error) {
    throw new Error(`Layout smoke: ${error}`)
  }
  await waitFor(
    async () => !!(await bridge.call('storage.get', { scope: 'ui.workspace', key: 'layout.v1' })),
  )
  assert(
    document.querySelector('.workspace-header').getBoundingClientRect().height === 42,
    'Title bar should be compact',
  )
  document.querySelector('.header-actions [aria-label="Open Settings"]').click()
  await waitFor(() => document.querySelector('.settings-panel'))
  const themeButtons = [...document.querySelectorAll('.theme-options button')]
  themeButtons.find((button) => button.textContent.includes('Dark')).click()
  await waitFor(() => document.documentElement.dataset.theme === 'dark')
  assert((await bridge.call('appearance.get')).theme === 'dark', 'Dark preference should persist')
  themeButtons.find((button) => button.textContent.includes('Light')).click()
  await waitFor(() => document.documentElement.dataset.theme === 'light')
  themeButtons.find((button) => button.textContent.includes('System')).click()
  await waitFor(async () => (await bridge.call('appearance.get')).theme === 'system')
  const appearance = await bridge.call('appearance.get')
  assert(
    (document.documentElement.dataset.theme === 'dark') === appearance.dark,
    'System palette should match native theme',
  )
  const locations = await bridge.call('data.locations')
  assert(
    locations.some((item) => item.id === 'chat') && locations.some((item) => item.id === 'planner'),
    'Settings should describe local data',
  )
  const settings = await bridge.call('chat.config.get')
  const saved = await bridge.call('chat.config.save', {
    baseURL: window.__smokeModelURL,
    model: 'test-model',
    systemPrompt: settings.defaultSystemPrompt,
    access: 'write',
    apiKey: 'smoke-only-key',
  })
  assert(
    saved.hasApiKey && !JSON.stringify(saved).includes('smoke-only-key'),
    'Settings must not return credentials',
  )
  const chatTools = await bridge.call('chat.tools')
  assert(
    ['read_file', 'edit_file', 'run_command'].every((name) =>
      chatTools.some((tool) => tool.name === name),
    ),
    'File and command tools should be listed in Settings',
  )
  document.querySelector('[aria-label="Open Chat"]').click()
  await waitFor(() => document.querySelector('.chat-composer .chat-editor'))
  // The composer is a TipTap editor, so type the way a user would.
  const chatEditor = document.querySelector('.chat-composer .chat-editor')
  chatEditor.focus()
  document.execCommand('insertText', false, 'Create a task in the Planner')
  await waitFor(() => !document.querySelector('.chat-composer button[type="submit"]').disabled)
  document.querySelector('.chat-composer button[type="submit"]').click()
  await waitFor(() =>
    document
      .querySelector('.chat-message.assistant .chat-markdown')
      ?.textContent.includes('Created the task'),
  )
  await waitFor(async () =>
    (await bridge.call('planner.get')).records.some((item) => item.title === 'Agent-created task'),
  )
  const history = await bridge.call('chat.list')
  assert(history.length === 1, 'Chat should persist a conversation')
  assert(history[0].folder === null, 'A new conversation starts with no folder')
  const conversation = await bridge.call('chat.get', { id: history[0].id })
  assert(conversation.messages.at(-1).tools[0].status === 'complete', 'Tool audit should persist')
  assert(
    conversation.messages.at(-1).tools[0].output.length > 0,
    'The transcript should keep a tool result to audit',
  )
  // Attaching a folder is a per-conversation decision, and reopening that
  // conversation from the sidebar brings the folder back with it.
  const folder = locations.find((item) => item.id === 'all').path
  const bound = await bridge.call('chat.setFolder', { id: history[0].id, folder })
  assert(typeof bound.folder === 'string' && bound.folder.length > 0, 'A folder should bind')
  assert(
    Array.isArray(await bridge.call('files.list', { folder: bound.folder, query: 'chat' })),
    'The mention picker should read the bound folder',
  )
  const folderName = bound.folder.split(/[\\/]/).filter(Boolean).pop()
  document.querySelector('.chat-thread').click()
  await waitFor(
    () => document.querySelector('.chat-toolbar .chat-folder')?.textContent.includes(folderName),
    'the header folder of the reopened conversation',
  )
  // The @ picker lists the bound folder and inserts a mention chip.
  chatEditor.focus()
  document.execCommand('insertText', false, '@')
  await waitFor(
    () => document.querySelectorAll('.chat-mentions button').length > 0,
    'the @ mention picker',
  )
  document
    .querySelector('.chat-mentions button')
    .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  await waitFor(
    () => Boolean(document.querySelector('.chat-editor .chat-mention')),
    'a mention chip',
  )
  const mentioned = document.querySelector('.chat-editor .chat-mention').getAttribute('data-id')
  assert(mentioned && mentioned.length > 0, 'A mention should carry the file path')
  return {
    ok: true,
    panels: 4,
    realShell: true,
    python: info.python,
    providerReload: true,
    featureReload: true,
    layoutSaved: true,
    plannerSaved: true,
    namedLayoutSaved: true,
    compactTitleBar: true,
    settingsTab: true,
    systemTheme: true,
    chatStreamingAndTools: true,
    encryptedCredential: true,
  }
})()
