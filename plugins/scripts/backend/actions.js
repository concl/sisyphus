const { validateProgram, validateScript } = require('./lib/scripts.js')
module.exports = () => ({
  id: 'desktop.script-actions',
  inject: ['scripts.v1', 'actions.v1'],
  apply(ctx) {
    const scripts = ctx.get('scripts.v1')
    const common = {
      outputs: [
        { key: 'stdout', label: 'Output', kind: 'text' },
        { key: 'stderr', label: 'Error output', kind: 'text' },
        { key: 'exitCode', label: 'Exit code', kind: 'number' },
      ],
    }
    const fields = [
      { key: 'args', label: 'Arguments', kind: 'lines', expose: true },
      { key: 'cwd', label: 'Working folder', kind: 'folder' },
      { key: 'stdin', label: 'Input', kind: 'text' },
      { key: 'detach', label: 'Continue after starting', kind: 'boolean' },
      { key: 'timeoutSeconds', label: 'Timeout (seconds)', kind: 'number', min: 1, max: 86400 },
    ]
    const defaults = { args: [], cwd: '', stdin: '', detach: false, timeoutSeconds: 300 }
    ctx.effect(() =>
      ctx.get('actions.v1').registerService('scripts', {
        name: 'Scripts',
        actions: {
          run: {
            ...common,
            name: 'Run program',
            description: 'Start an executable with arguments.',
            aliases: ['run', 'system.run'],
            defaults: { ...defaults, program: '' },
            fields: [{ key: 'program', label: 'Program', kind: 'file', expose: true }, ...fields],
            validate: validateProgram,
            execute: (input, context) => scripts.run(input, context),
          },
          runScript: {
            ...common,
            name: 'Run script',
            description: 'Run a script using an interpreter.',
            defaults: { ...defaults, interpreter: 'python', path: '' },
            fields: [
              { key: 'interpreter', label: 'Interpreter', kind: 'text' },
              { key: 'path', label: 'Script', kind: 'file', expose: true },
              ...fields,
            ],
            validate: validateScript,
            execute: (input, context) => scripts.runScript(input, context),
          },
        },
      }),
    )
  },
})
