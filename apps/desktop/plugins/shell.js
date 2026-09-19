const { z } = require('zod')
const { resolveInside } = require('../lib/chat-folder')
const {
  runCommand,
  formatResult,
  defaultBackend,
  MAX_TIMEOUT,
  DEFAULT_TIMEOUT,
} = require('../lib/shell-run')

// Commands run through the same shell the terminal block detects, in the
// conversation folder, and the process tree is killed on timeout or stop.
module.exports = () => ({
  id: 'desktop.shell',
  name: 'Shell commands',
  inject: ['agent.tools.v1'],
  apply(ctx) {
    const registry = ctx.get('agent.tools.v1')
    let backend
    const getBackend = () => (backend ??= defaultBackend())
    ctx.effect(() => {
      const shell = getBackend()
      return registry.register('run_command', {
        description: `Run one non-interactive shell command (${shell.name}) inside the conversation folder and return its exit code and output. Use a single command that finishes on its own: no interactive prompts, editors, servers, or watch modes. Prefer the file tools for reading and editing files.`,
        access: 'write',
        inputSchema: z
          .object({
            command: z.string().trim().min(1).max(8000),
            cwd: z
              .string()
              .max(1024)
              .optional()
              .describe('Folder to run in, relative to the conversation folder'),
            timeoutMs: z.number().int().positive().max(MAX_TIMEOUT).optional(),
          })
          .strict(),
        execute: async (input, context) => {
          if (!context?.folder)
            throw new Error('This conversation has no folder. Choose one, then try again.')
          const cwd = input.cwd ? resolveInside(context.folder, input.cwd) : context.folder
          const result = await runCommand({
            command: input.command,
            cwd,
            timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT,
            backend: shell,
            signal: context.signal,
          })
          return formatResult(result)
        },
      })
    })
  },
})
