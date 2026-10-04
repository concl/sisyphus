const { validateProgram, validateScript } = require('./lib/scripts.js')
module.exports = () => ({
  id: 'desktop.script-actions',
  inject: ['scripts.v1', 'actions.v1'],
  apply(ctx) {
    const scripts = ctx.get('scripts.v1')
    const common = {
      effects: [
        'Runs local code with the permissions of Sisyphus. The program may change files, start applications, or contact services.',
      ],
      notes: [
        'Arguments are literal values, one per line; no implicit shell expansion. Select a shell explicitly to run shell commands.',
        'Normally waits for exit, captures the latest 32,000 characters from each output stream, and fails on a nonzero exit code.',
        'Continue after starting detaches the process: output is empty, exitCode is null, timeout does not apply, and Stop leaves it running. Detached programs cannot receive Input.',
      ],
      outputs: [
        {
          key: 'stdout',
          label: 'Output',
          kind: 'text',
          hint: 'Captured standard output. Connect to Read JSON to parse a script response.',
        },
        {
          key: 'stderr',
          label: 'Error output',
          kind: 'text',
          hint: 'Captured standard error; writing here alone does not fail the step.',
        },
        {
          key: 'exitCode',
          label: 'Exit code',
          kind: 'number',
          hint: '0 on success, or null when detached. A nonzero exit fails the step.',
        },
      ],
    }
    const fields = [
      {
        key: 'args',
        label: 'Arguments',
        kind: 'lines',
        expose: true,
        hint: 'One literal argument per line. Do not add shell quotes.',
      },
      {
        key: 'cwd',
        label: 'Working folder',
        kind: 'folder',
        hint: 'Optional absolute path. Empty inherits the application’s working folder.',
      },
      {
        key: 'stdin',
        label: 'Input',
        kind: 'text',
        hint: 'Text sent to standard input, then the stream is closed. Leave empty when detached.',
      },
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
            calls: ['scripts.v1.run(input) → child_process.spawn(program, args)'],
            examples: [
              {
                title: 'Get the Python version',
                input: { program: 'python', args: ['--version'] },
              },
            ],
            aliases: ['run', 'system.run'],
            defaults: { ...defaults, program: '' },
            fields: [
              {
                key: 'program',
                label: 'Program',
                kind: 'file',
                expose: true,
                required: true,
                hint: 'Executable name on PATH or an absolute path, for example python or powershell.exe.',
              },
              ...fields,
            ],
            validate: validateProgram,
            execute: (input, context) => scripts.run(input, context),
          },
          runScript: {
            ...common,
            name: 'Run script',
            description: 'Run a script using an interpreter.',
            calls: [
              'scripts.v1.runScript(input) → scripts.v1.run({ program: interpreter, args: [path, ...args] })',
            ],
            examples: [
              {
                title: 'Run a Python script',
                input: {
                  interpreter: 'python',
                  path: 'C:\\scripts\\report.py',
                  args: ['--format', 'json'],
                },
              },
            ],
            defaults: { ...defaults, interpreter: 'python', path: '' },
            fields: [
              {
                key: 'interpreter',
                label: 'Interpreter',
                kind: 'text',
                required: true,
                hint: 'Executable name on PATH or an absolute interpreter path.',
              },
              {
                key: 'path',
                label: 'Script',
                kind: 'file',
                expose: true,
                required: true,
                hint: 'Absolute path to the script. The script is used in place; it is not copied.',
              },
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
