const { BrowserWindow, dialog } = require('electron')
const { Automations } = require('./lib/automations.js')
const { checkProgram } = require('./lib/workflow-engine.js')
const { AutomationFiles } = require('./lib/automation-files.js')
const { readLauncherPrograms } = require('./lib/import-launchers.js')
const { automationTools } = require('./lib/action-tools.js')

module.exports = ({ userData }) => ({
  id: 'desktop.automations',
  name: 'Actions',
  inject: ['transport.v1', 'agent.tools.v1', 'actions.v1'],
  provide: ['automations.v1', 'workflows.v1'],
  apply(ctx) {
    const transport = ctx.get('transport.v1')
    const broadcast = (event, value) => {
      for (const window of BrowserWindow.getAllWindows())
        if (!window.isDestroyed()) transport.send(window.webContents, event, value)
    }
    const automations = new Automations({
      files: new AutomationFiles(userData),
      actions: ctx.get('actions.v1'),
      importLegacy: () => readLauncherPrograms(userData),
      onRun: (run) => broadcast('automations.run', run),
    })
    ctx.provide('automations.v1', automations)
    ctx.provide('workflows.v1', {
      run: (program, inputs) => automations.run(program, inputs),
      runProgram: (id, inputs) => automations.runProgram(id, inputs),
      runCard: (id, inputs, context) => automations.runCard(id, inputs, context),
      cancel: (id) => automations.cancel(id),
    })
    ctx.effect(() =>
      automations.actions.subscribe((types) => broadcast('automations.types.changed', types)),
    )
    ctx.effect(() => () => automations.dispose())
    ctx.effect(() =>
      automations.actions.registerService('automation', {
        name: 'Actions',
        actions: {
          runCard: {
            name: 'Run card',
            description: 'Run another saved card and use its results.',
            effects: [
              'Runs every action in the selected card, including their state changes. Input overrides apply only to this run and do not edit the saved card.',
            ],
            calls: [
              'automations.v1.runCard(cardId, inputValues, context) → starts the saved workflow and waits for completion',
            ],
            notes: [
              'Fails if the card fails, is stopped, is missing, or is already running. Recursive calls to an active card are rejected.',
              'Stop propagates to the child workflow. Completed actions are not undone.',
            ],
            examples: [
              {
                title: 'Use the card’s saved inputs',
                input: { cardId: 'your-card-id', inputValues: {} },
              },
            ],
            defaults: { cardId: '', inputValues: {} },
            fields: [
              {
                key: 'cardId',
                label: 'Card',
                kind: 'text',
                editor: 'automation.card',
                required: true,
                hint: 'Choose a saved card.',
              },
              {
                key: 'inputValues',
                label: 'Inputs',
                kind: 'json',
                hint: 'Optional object keyed by the selected card’s input keys. Empty uses its saved values.',
              },
            ],
            outputs: [
              { key: 'nodes', label: 'Step results', kind: 'json' },
              { key: 'status', label: 'Status', kind: 'text' },
            ],
            validate: ({ cardId, inputValues }) => {
              if (typeof cardId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(cardId))
                throw new Error('Choose a card')
              if (!inputValues || typeof inputValues !== 'object' || Array.isArray(inputValues))
                throw new Error('Inputs need an object')
            },
            execute: ({ cardId, inputValues }, context) =>
              automations.runCard(cardId, inputValues, context),
          },
        },
      }),
    )
    const changed = (operation) => (input) => {
      const value = operation(input)
      broadcast('automations.changed', automations.list())
      return value
    }
    ctx.effect(() => transport.handle('automations.list', () => automations.list()))
    ctx.effect(() => transport.handle('automations.types', () => automations.types()))
    ctx.effect(() => transport.handle('automations.runs', () => automations.snapshot()))
    ctx.effect(() =>
      transport.handle('automations.check', ({ flow, inputValues }) =>
        checkProgram(flow, automations.actions, inputValues),
      ),
    )
    ctx.effect(() =>
      transport.handle(
        'automations.inputs.set',
        changed(({ id, inputValues, drafts }) => automations.setInputs(id, inputValues, drafts)),
      ),
    )
    ctx.effect(() =>
      transport.handle(
        'automations.save',
        changed((flow) => automations.save(flow)),
      ),
    )
    ctx.effect(() =>
      transport.handle(
        'automations.delete',
        changed(({ id }) => automations.delete(id)),
      ),
    )
    ctx.effect(() =>
      transport.handle(
        'automations.reorder',
        changed(({ ids }) => automations.reorder(ids)),
      ),
    )
    ctx.effect(() =>
      transport.handle('automations.start', ({ id, inputValues }) =>
        automations.start(id, inputValues),
      ),
    )
    ctx.effect(() => transport.handle('automations.cancel', ({ id }) => automations.cancel(id)))
    ctx.effect(() =>
      transport.handle('automations.choose', async ({ kind }, sender) => {
        const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(sender), {
          title: kind === 'folder' ? 'Choose a folder' : 'Choose a file',
          properties: [kind === 'folder' ? 'openDirectory' : 'openFile'],
        })
        return { path: result.canceled ? null : result.filePaths[0] }
      }),
    )
    const tools = ctx.get('agent.tools.v1')
    // The chat model builds a saved card from an ordered list of steps. These
    // tools turn that description into node ids, positions, and connections, so
    // creating or editing an action does not mean hand-writing its JSON files.
    const definitions = automationTools({
      automations,
      onChange: () => broadcast('automations.changed', automations.list()),
    })
    for (const { name, description, access, inputSchema, execute } of definitions)
      ctx.effect(() => tools.register(name, { description, access, inputSchema, execute }))
  },
})
