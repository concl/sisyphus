const fs = require('node:fs')
const { z } = require('zod')
const { resolveInside, validateFolder } = require('@sisyphus/native/folder')
const { createVSCodeLauncher } = require('./lib/vscode-launcher.js')

module.exports = ({ userData }) => ({
  id: 'desktop.integration.vscode',
  name: 'VS Code integration',
  inject: ['integrations.v1', 'agent.tools.v1'],
  apply(ctx) {
    const integrations = ctx.get('integrations.v1')
    const tools = ctx.get('agent.tools.v1')
    const launcher = createVSCodeLauncher({ userData })
    ctx.effect(() =>
      integrations.register('vscode', {
        name: 'Visual Studio Code',
        available: launcher.available,
        launch: (input) =>
          launcher.openContext({
            ...input,
            folders: input.folders.map(validateFolder),
          }),
      }),
    )
    ctx.effect(() =>
      tools.register('open_in_editor', {
        description:
          'Open a file from the conversation folder in Visual Studio Code, optionally at a line and column.',
        access: 'write',
        inputSchema: z
          .object({
            path: z.string().min(1).max(1024),
            line: z.number().int().positive().optional(),
            column: z.number().int().positive().optional(),
          })
          .strict(),
        execute: async (input, context) => {
          if (!context?.folder)
            throw new Error('This conversation has no folder. Choose one, then try again.')
          const file = resolveInside(context.folder, input.path)
          if (!fs.statSync(file).isFile()) throw new Error('Choose a file to open in VS Code')
          await launcher.openFile({ file, line: input.line, column: input.column })
          return `Opened ${input.path} in Visual Studio Code.`
        },
      }),
    )
  },
})
