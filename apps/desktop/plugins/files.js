const { z } = require('zod')
const { FileBridge } = require('../lib/mcp-files')
const { FileIndex } = require('../lib/file-index')

// Curated subset of the MCP filesystem server. Descriptions are written for the
// model; the server itself validates every path against the conversation folder.
const TOOLS = [
  {
    name: 'read_file',
    access: 'read',
    target: 'read_text_file',
    description:
      'Read a text file inside the conversation folder. Paths are relative to that folder. Use head or tail to read only the first or last N lines of a large file.',
    schema: z
      .object({
        path: z.string().min(1).max(1024),
        head: z.number().int().positive().optional(),
        tail: z.number().int().positive().optional(),
      })
      .strict(),
  },
  {
    name: 'list_directory',
    access: 'read',
    target: 'list_directory',
    description:
      'List the entries of a directory inside the conversation folder. Paths are relative to the folder; use "." for the folder root.',
    schema: z.object({ path: z.string().max(1024).default('.') }).strict(),
  },
  {
    name: 'search_files',
    access: 'read',
    target: 'search_files',
    description:
      'Find files by glob pattern, for example **/*.test.ts or src/**/*.md, inside the conversation folder. Returns matching file paths.',
    schema: z
      .object({
        path: z.string().max(1024).default('.'),
        pattern: z.string().min(1).max(200),
        excludePatterns: z.array(z.string().max(200)).max(20).optional(),
      })
      .strict(),
  },
  {
    name: 'create_directory',
    access: 'write',
    target: 'create_directory',
    description:
      'Create a directory inside the conversation folder, including missing parents. Do this before write_file when the target folder does not exist yet.',
    schema: z.object({ path: z.string().min(1).max(1024) }).strict(),
  },
  {
    name: 'write_file',
    access: 'write',
    target: 'write_file',
    description:
      'Create or overwrite a file inside the conversation folder with the full content. Prefer edit_file for a small change to an existing file.',
    schema: z.object({ path: z.string().min(1).max(1024), content: z.string() }).strict(),
  },
  {
    name: 'edit_file',
    access: 'write',
    target: 'edit_file',
    description:
      'Replace exact text in an existing file inside the conversation folder. Each oldText must match the file exactly and appear once. Set dryRun to preview a diff first.',
    schema: z
      .object({
        path: z.string().min(1).max(1024),
        edits: z
          .array(
            z
              .object({
                oldText: z.string().min(1).describe('Text to find, matching the file exactly'),
                newText: z.string().describe('Replacement text'),
              })
              .strict(),
          )
          .min(1)
          .max(50),
        dryRun: z.boolean().optional().default(false),
      })
      .strict(),
  },
]

module.exports = ({ index } = {}) => ({
  id: 'desktop.files',
  name: 'Files and folders',
  inject: ['transport.v1', 'agent.tools.v1'],
  apply(ctx) {
    const transport = ctx.get('transport.v1')
    const registry = ctx.get('agent.tools.v1')
    const bridge = new FileBridge()
    const files = index || new FileIndex()
    ctx.effect(() => () => bridge.dispose())
    // Backs the @-mention picker in the composer.
    ctx.effect(() =>
      transport.handle('files.list', ({ folder, query, limit }) =>
        files.list(folder, query, limit),
      ),
    )
    const folderOf = (context) => {
      if (!context?.folder)
        throw new Error('This conversation has no folder. Choose one, then try again.')
      return context.folder
    }
    for (const definition of TOOLS) {
      ctx.effect(() =>
        registry.register(definition.name, {
          description: definition.description,
          access: definition.access,
          inputSchema: definition.schema,
          execute: async (input, context) =>
            bridge.call(folderOf(context), definition.target, input),
        }),
      )
    }
  },
})

module.exports.TOOLS = TOOLS
