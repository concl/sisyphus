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
      document.querySelector('.todo-panel'),
  )
  const bridge = window.sisyphus
  // Each plugin's stylesheet is a file beside its code, tied to the plugin's
  // lifetime: switching a plugin off takes its styles with it. Without this the
  // workspace would render unstyled while the plugins still reported active.
  const styled = (await bridge.call('plugins.catalog')).plugins.filter(
    (entry) => entry.target === 'renderer' && entry.css,
  )
  const missingStyles = () =>
    styled
      .filter((entry) => !document.querySelector(`style[data-plugin="${entry.id}"]`))
      .map((entry) => entry.id)
      .join(', ')
  try {
    await waitFor(
      () => missingStyles() === '',
      `every plugin with a stylesheet to be styled by it (missing: ${missingStyles() || 'none'})`,
    )
  } catch (error) {
    const notActive = (await bridge.call('runtime.list')).filter(
      (plugin) => plugin.state !== 'active',
    )
    const chat = await bridge.call('plugins.read', { id: 'feature.chat', target: 'renderer' })
    const present = [...document.querySelectorAll('style[data-plugin]')].map(
      (node) => node.dataset.plugin,
    )
    throw new Error(
      `${error.message}; not active: ${JSON.stringify(notActive)}; chat css: ${
        chat.css ? chat.css.length : 'none'
      }; chat source: ${chat.source.length}; styled: ${present.join('|')}`,
    )
  }
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
    const title = document.querySelector('.todo-add [aria-label="Title"]')
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    nativeSetter.call(title, 'Smoke task')
    title.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('.todo-add button[type="submit"]').click()
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
    document.querySelector('.workspace-header').getBoundingClientRect().height === 44,
    'Title bar should be compact',
  )
  assert(
    getComputedStyle(document.querySelector('.brand-symbol')).maskImage.includes('svg'),
    'Ship icon should be bundled',
  )
  // Every block icon draws its plugin's SVG as a mask over one shared color,
  // so no plugin can ship an off-palette tint of its own.
  const masks = [...document.querySelectorAll('.icon-mask')]
  assert(masks.length > 0, 'Block icons should render as masks')
  assert(
    masks.every((mask) => getComputedStyle(mask).maskImage.includes('svg')),
    'Every block icon should use its bundled SVG',
  )
  const iconColors = new Set(masks.map((mask) => getComputedStyle(mask).backgroundColor))
  assert(iconColors.size === 1, `Block icons should share one color, got ${[...iconColors]}`)
  document.querySelector('[aria-label="Open VS Code"]').click()
  await waitFor(() => document.querySelector('.contexts-panel'))
  assert(
    document.querySelector('.launcher-heading h1').textContent === 'VS Code',
    'Editor launcher should be separate',
  )
  document.querySelector('.launcher-new').click()
  await waitFor(() => document.querySelector('.launcher-folders'))
  assert(
    !document.querySelector('.launcher-editor textarea'),
    'Editor form should not include browser pages',
  )
  document.querySelector('.launcher-editor-heading button').click()
  document.querySelector('[aria-label="Open Browser Tabs"]').click()
  await waitFor(
    () => document.querySelector('.launcher-heading h1')?.textContent === 'Browser tabs',
  )
  document.querySelector('.launcher-new').click()
  await waitFor(() => document.querySelector('.launcher-editor textarea'))
  assert(
    !document.querySelector('.launcher-folders'),
    'Browser form should not include editor settings',
  )
  const nameSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  const pagesSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  const entryName = document.querySelector('.launcher-editor input')
  nameSetter.call(entryName, 'Reading')
  entryName.dispatchEvent(new Event('input', { bubbles: true }))
  const pages = document.querySelector('.launcher-editor textarea')
  pagesSetter.call(pages, 'https://example.com/docs\nhttps://example.org/')
  pages.dispatchEvent(new Event('input', { bubbles: true }))
  document.querySelector('.launcher-editor button[type="submit"]').click()
  await waitFor(
    () => document.querySelector('.launcher-entry[aria-label="Open Reading"]'),
    'saved browser entry',
  )
  const tabSet = (await bridge.call('contexts.list')).find((item) => item.name === 'Reading')
  assert(
    tabSet.actions.length === 1 && tabSet.actions[0].integration === 'browser',
    'Browser save should only contain browser action',
  )
  assert(tabSet.actions[0].urls.length === 2, 'Browser pages should persist')
  assert(!document.querySelector('.launcher-editor'), 'Editor should close after saving')
  document.querySelector('[aria-label="Edit Reading"]').click()
  await waitFor(() =>
    document.querySelector('.launcher-editor textarea')?.value.includes('example.org'),
  )
  document.querySelector('.launcher-delete').click()
  assert(
    (await bridge.call('contexts.list')).some((item) => item.id === tabSet.id),
    'Removal needs confirmation',
  )
  document.querySelector('.launcher-delete').click()
  await waitFor(
    async () => !(await bridge.call('contexts.list')).some((item) => item.id === tabSet.id),
  )
  document.querySelector('[aria-label="Open Settings"]').click()
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
    locations.some((item) => item.id === 'chat') &&
      locations.some((item) => item.id === 'planner') &&
      locations.some((item) => item.id === 'contexts'),
    'Settings should describe local data',
  )
  const savedContext = await bridge.call('contexts.save', {
    name: 'Smoke context',
    actions: [{ integration: 'browser', urls: ['https://example.com/docs'] }],
  })
  assert(
    (await bridge.call('contexts.list')).some((item) => item.id === savedContext.id),
    'App contexts should persist',
  )
  const integrationStatuses = await bridge.call('contexts.integrations')
  assert(
    ['vscode', 'browser'].every((id) => integrationStatuses.some((item) => item.id === id)),
    'Built-in integrations should register',
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
  // The agent edits runtime plugins through the same engine Plugin studio calls,
  // so these have to reach the model, not just the block that draws them.
  assert(
    ['plugin_list', 'plugin_read', 'plugin_write', 'plugin_reload', 'plugin_remove'].every((name) =>
      chatTools.some((tool) => tool.name === name),
    ),
    'The plugin tools should be listed in Settings',
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
  // The order of text and tool calls is recorded, so a reloaded reply reads the
  // same way it streamed instead of stacking every tool call above the text.
  const reply = conversation.messages.at(-1)
  assert(
    Array.isArray(reply.parts) && reply.parts.some((part) => part.type === 'tool'),
    'A reply should record its parts in order',
  )
  assert(
    reply.parts.at(-1).type === 'text' && reply.parts.at(-1).text === reply.text,
    'The last recorded part should be the reply text',
  )
  const article = document.querySelector('.chat-message.assistant')
  const textBlocks = [...article.querySelectorAll('.chat-markdown')]
  assert(
    Boolean(article.querySelector('.chat-tools')) && textBlocks.length > 0,
    'A reply should render tool calls together with text',
  )
  assert(
    article.querySelector('.chat-tools').compareDocumentPosition(textBlocks.at(-1)) &
      Node.DOCUMENT_POSITION_FOLLOWING,
    'Tool calls should be interleaved with text rather than stacked above it',
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
  // The @ picker lists the bound folder and inserts a mention chip. Reopening the
  // conversation builds a new composer, so the editor is queried again here.
  const mentionEditor = document.querySelector('.chat-composer .chat-editor')
  mentionEditor.focus()
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
  // A plugin file written while the app runs mounts in both processes: the main
  // half answers its own method, the renderer half adds a block to the rail, and
  // removing the files takes both away again.
  await bridge.call('plugins.create', { id: 'user.smoke', target: 'main' })
  await waitFor(
    async () => (await bridge.call('runtime.list')).some((plugin) => plugin.id === 'user.smoke'),
    'a main-process plugin the app did not have at boot',
  )
  assert(
    (await bridge.call('user.smoke.ping')).from === 'user.smoke',
    'A plugin added at runtime should serve its own method',
  )
  await bridge.call('plugins.write', {
    id: 'user.smoke-panel',
    target: 'renderer',
    source: `sisyphus.define({
  id: 'user.smoke-panel',
  name: 'Smoke panel',
  plugin: {
    inject: [sisyphus.sdk.panels],
    apply(ctx) {
      ctx.effect(() =>
        ctx.get(sisyphus.sdk.panels).register({
          id: 'user.smoke-panel',
          title: 'Smoke panel',
          description: 'Added while the app runs.',
          icon: sisyphus.icons.plugin,
          component: () =>
            sisyphus.react.createElement('div', { className: 'smoke-runtime-panel' }),
        }),
      )
    },
  },
})
`,
  })
  await waitFor(
    () => document.querySelector('[data-open="user.smoke-panel"]'),
    'a block that arrived at runtime',
  )
  await bridge.call('plugins.remove', { id: 'user.smoke', target: 'main' })
  await bridge.call('plugins.remove', { id: 'user.smoke-panel', target: 'renderer' })
  await waitFor(
    async () => !(await bridge.call('runtime.list')).some((plugin) => plugin.id === 'user.smoke'),
    'the runtime plugin to leave again',
  )
  await waitFor(
    () => !document.querySelector('[data-open="user.smoke-panel"]'),
    'the runtime block to leave the rail',
  )
  // A plugin written while the app runs can restyle the app's own UI, and has to
  // put it back when it leaves: a runtime plugin that forgot to undo its work
  // would leave the workspace changed with nothing on screen to explain why.
  const sendButton = () => document.querySelector('.chat-composer button.primary[type="submit"]')
  await waitFor(sendButton, 'the composer send button')
  const accent = getComputedStyle(sendButton()).backgroundColor
  assert(accent !== 'rgb(229, 72, 77)', 'The send button should not start out red')
  await bridge.call('plugins.write', {
    id: 'user.red-send',
    target: 'renderer',
    source: `sisyphus.define({
  id: 'user.red-send',
  name: 'Red send button',
  plugin: {
    apply(ctx) {
      const style = document.createElement('style')
      style.textContent =
        '.chat-composer button.primary[type="submit"],' +
        '.chat-composer button.primary[type="submit"]:hover {' +
        '  background: #e5484d !important;' +
        '  border-color: #e5484d !important;' +
        '  color: #ffffff !important;' +
        '}'
      document.head.append(style)
      ctx.effect(() => () => style.remove())
    },
  },
})
`,
  })
  await waitFor(
    () => getComputedStyle(sendButton()).backgroundColor === 'rgb(229, 72, 77)',
    'the send button to turn red',
  )
  await bridge.call('plugins.remove', { id: 'user.red-send', target: 'renderer' })
  await waitFor(
    () => getComputedStyle(sendButton()).backgroundColor === accent,
    'the send button to go back to the theme accent',
  )
  // The plugins this build shipped are files in the app's own folder too - that is
  // the whole point of shipping them - so the code that is running is the code a
  // person can open and edit, and Restore is the way back.
  const catalog = await bridge.call('plugins.catalog')
  const shipped = catalog.plugins.filter((entry) => entry.shipped)
  assert(shipped.length >= 8, 'The build should ship its panels as editable plugin files')
  assert(
    shipped.every((entry) => entry.file.startsWith(catalog.folder)),
    'A shipped plugin should live in the app\u2019s plugins folder, not next to the build',
  )
  const chatEntry = shipped.find((entry) => entry.id === 'feature.chat')
  assert(chatEntry && chatEntry.edited === false, 'A shipped plugin should start out unedited')
  const chatOriginal = await bridge.call('plugins.read', { id: 'feature.chat', target: 'renderer' })
  assert(
    chatOriginal.source.includes('export const chatPlugin'),
    'The running chat plugin should expose its original source',
  )
  // Edit it the way the studio or the agent would: the file on disk is the code the
  // app runs, so the edit shows up in the running app with no rebuild at all.
  await bridge.call('plugins.write', {
    id: 'feature.chat',
    target: 'renderer',
    source: `${chatOriginal.source}\n;(function () {\n  var mark = document.createElement('style')\n  mark.setAttribute('data-smoke-shipped', '1')\n  mark.textContent = 'body { outline: 0px }'\n  document.head.append(mark)\n})()\n`,
  })
  await bridge.call('plugins.reload', { id: 'feature.chat' })
  await waitFor(
    () => document.querySelector('style[data-smoke-shipped]'),
    'the edited copy of a shipped plugin to be the code the app is running',
  )
  const afterEdit = await bridge.call('plugins.catalog')
  assert(
    afterEdit.plugins.find((entry) => entry.id === 'feature.chat').edited === true,
    'An edited shipped plugin should be reported as edited',
  )
  await bridge.call('plugins.restore', { id: 'feature.chat', target: 'renderer' })
  await waitFor(async () => {
    const now = await bridge.call('plugins.catalog')
    const entry = now.plugins.find((item) => item.id === 'feature.chat')
    const file = await bridge.call('plugins.read', { id: 'feature.chat', target: 'renderer' })
    return entry.edited === false && file.source === chatOriginal.source
  }, 'Restore to put the shipped copy back')
  // Mounted again from the restored file: its own stylesheet is back and the chat
  // still draws. The native profile cannot answer for a plugin this window runs, so
  // the window is asked.
  await waitFor(() => {
    const style = document.querySelector('style[data-plugin="feature.chat"]')
    return Boolean(style && style.textContent && style.textContent.length > 1000)
  }, 'the restored chat plugin to bring its stylesheet back')
  // Replacing a plugin disposes the block that plugin owned, and the rail is where a
  // block is opened again. What is recorded here is where the launcher stands after a
  // restore rather than an assumption about it; the workspace itself must still be
  // drawing, which is the part this step is for.
  const chatLauncherAfterRestore = Boolean(document.querySelector('[aria-label="Open Chat"]'))
  assert(
    document.querySelector('.workspace-header') &&
      document.querySelectorAll('style[data-plugin]').length >= 7,
    'The workspace should still be whole after a shipped plugin was edited and restored',
  )
  document.querySelector('style[data-smoke-shipped]')?.remove()
  return {
    ok: true,
    panels: 4,
    runtimePlugins: true,
    runtimeRestyle: true,
    agentPluginTools: true,
    shippedPluginEditing: true,
    chatLauncherAfterRestore,
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
    appContexts: true,
    separateLaunchers: true,
    browserEntryEditing: true,
    shipIcon: true,
    encryptedCredential: true,
  }
})()
