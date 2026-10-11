// Source packages are the runtime unit. Generated code is an in-memory cache.
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { createHash } = require('node:crypto')
const { build } = require('esbuild')

// These are esbuild's source formats, not a list of permitted assets. Everything
// else is an opaque file, including formats introduced by a plugin dependency.
const sourceExtensions = new Set([
  '',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.mts',
  '.cts',
  '.tsx',
  '.json',
  '.css',
])
function inlineAssets() {
  const resolvingAsset = {}
  return {
    name: 'inline-assets',
    setup(builder) {
      // A CSS url() always refers to bytes, even for extensionless files or files
      // whose extension also names a source language. Keep normal URL resolution
      // (including external URLs and query/fragment suffixes) in esbuild's hands.
      builder.onResolve({ filter: /.*/, namespace: 'file' }, async (args) => {
        if (args.kind !== 'url-token' || args.pluginData === resolvingAsset) return
        const resolved = await builder.resolve(args.path, {
          importer: args.importer,
          resolveDir: args.resolveDir,
          kind: args.kind,
          namespace: args.namespace,
          pluginData: resolvingAsset,
        })
        if (resolved.external || resolved.errors.length) return resolved
        return { ...resolved, namespace: 'asset' }
      })
      const load = async (args) => ({
        contents: await fs.promises.readFile(args.path),
        loader: 'dataurl',
      })
      builder.onLoad({ filter: /.*/, namespace: 'asset' }, load)
      builder.onLoad({ filter: /.*/, namespace: 'file' }, (args) => {
        if (sourceExtensions.has(path.extname(args.path)) || Object.keys(args.with).length) return
        return load(args)
      })
    },
  }
}

const shared = {
  react: 'react',
  'react/jsx-runtime': 'jsx',
  'react-dom': 'reactDom',
  'react-dom/client': 'reactDomClient',
  '@sisyphus/sdk': 'sdk',
  '@sisyphus/profile': 'profile',
  '@sisyphus/profile/preferences': 'preferences',
  '@sisyphus/ui': 'ui',
  '@deepseek-ai/cordis': 'cordis',
}
const excluded = new Set([
  'node_modules',
  '.git',
  '.runtime',
  'dist',
  '.venv',
  '__pycache__',
  '.pytest_cache',
])
const ignoredPath = (name) =>
  String(name)
    .split(/[\\/]/)
    .some((part) => excluded.has(part))
function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (excluded.has(entry.name) || entry.isSymbolicLink()) return []
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? filesIn(file) : entry.isFile() ? [file] : []
  })
}
function inside(directory, relative) {
  const file = path.resolve(directory, relative)
  if (!file.startsWith(path.resolve(directory) + path.sep))
    throw new Error('Plugin entry escapes its folder')
  return file
}
function packages(directory) {
  if (!fs.existsSync(directory)) return []
  const result = []
  for (const child of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!child.isDirectory() || excluded.has(child.name)) continue
    const folder = path.join(directory, child.name)
    const manifest = path.join(folder, 'package.json')
    if (!fs.existsSync(manifest)) continue
    try {
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'))
      const meta = pkg.sisyphus
      if (!meta) continue
      const files = filesIn(folder)
      // Existing editable installations may still use entry/native manifests.
      // Keep the wire targets stable while source packages use frontend/backend.
      const frontend = meta.frontend ?? (meta.entry ? meta : [])
      const frontends = Array.isArray(frontend) ? frontend : [frontend]
      const backend = meta.backend ?? meta.native ?? []
      if (!Array.isArray(backend)) throw new Error('sisyphus.backend must be an array')
      for (const [key, entries] of [
        ['frontend', frontends],
        ['backend', backend],
      ]) {
        if (
          entries.some(
            (entry) =>
              !entry ||
              typeof entry !== 'object' ||
              Array.isArray(entry) ||
              typeof entry.entry !== 'string' ||
              !entry.entry.trim(),
          )
        )
          throw new Error(`sisyphus.${key} entries must declare an entry path`)
      }
      const entries = [
        ...frontends.map((entry) => ({ ...entry, target: 'renderer' })),
        ...backend.map((entry) => ({ ...entry, target: 'main' })),
      ]
      const claimed = new Set()
      const discovered = []
      for (const entry of entries) {
        const key = `${entry.id}:${entry.target}`
        if (claimed.has(key))
          throw new Error(`Duplicate plugin entry: ${entry.id} (${entry.target})`)
        claimed.add(key)
        const stamp = createHash('sha256')
          .update(
            files
              .filter((file) => {
                const relative = path.relative(folder, file).replaceAll('\\', '/')
                // UI edits must not restart native jobs in the same feature package.
                if (entry.target === 'renderer')
                  return !['native/', 'backend/', 'worker/', 'service/'].some((prefix) =>
                    relative.startsWith(prefix),
                  )
                const separateBackend = /^\.\/(native|backend)\//.test(entry.entry)
                return (
                  !separateBackend ||
                  !['src/', 'frontend/'].some((prefix) => relative.startsWith(prefix))
                )
              })
              .map((file) => {
                const stat = fs.statSync(file)
                return `${path.relative(folder, file)}:${stat.mtimeMs}:${stat.size}`
              })
              .join('|'),
          )
          .digest('hex')
        if (!/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/.test(entry.id))
          throw new Error('Invalid plugin id')
        discovered.push({
          ...entry,
          file: inside(folder, entry.entry),
          folder,
          package: child.name,
          format: 'source',
          mtime: stamp,
          export: entry.export ?? 'default',
        })
      }
      result.push(...discovered)
    } catch (error) {
      result.push({ id: child.name, target: null, folder, file: manifest, error: error.message })
    }
  }
  // Discovery is atomic per package, including collisions with other packages.
  const owners = new Map()
  const conflicts = new Map()
  for (const entry of result.filter((entry) => entry.target)) {
    const key = `${entry.id}:${entry.target}`
    const previous = owners.get(key)
    if (previous) {
      const error = `Plugin ${entry.id} (${entry.target}) is claimed by ${previous.package} and ${entry.package}`
      conflicts.set(previous.folder, error)
      conflicts.set(entry.folder, error)
    } else owners.set(key, entry)
  }
  const reported = new Set()
  return result.flatMap((entry) => {
    if (!conflicts.has(entry.folder)) return [entry]
    if (reported.has(entry.folder)) return []
    reported.add(entry.folder)
    return [
      {
        id: entry.package,
        target: null,
        folder: entry.folder,
        file: path.join(entry.folder, 'package.json'),
        error: conflicts.get(entry.folder),
      },
    ]
  })
}

async function compile(entry) {
  const renderer = entry.target === 'renderer'
  const result = await build({
    absWorkingDir: entry.folder,
    entryPoints: [entry.file],
    bundle: true,
    write: false,
    outfile: path.join(entry.folder, '.runtime', `${entry.id}.js`),
    platform: renderer ? 'browser' : 'node',
    format: renderer ? 'iife' : 'cjs',
    globalName: renderer ? '__sisyphusPlugin' : undefined,
    target: 'es2022',
    jsx: 'automatic',
    nodePaths: require.resolve.paths('react'),
    external: renderer
      ? []
      : [
          'electron',
          'node-pty',
          '@modelcontextprotocol/server-filesystem',
          '@modelcontextprotocol/server-filesystem/*',
        ],
    define: renderer ? { 'process.env.NODE_ENV': '"production"', global: 'globalThis' } : {},
    footer: renderer
      ? { js: `SisyphusRuntime.register(${JSON.stringify(entry.id)}, __sisyphusPlugin);` }
      : {},
    plugins: [
      inlineAssets(),
      {
        name: 'host-contracts',
        setup(builder) {
          if (renderer) {
            builder.onResolve({ filter: /.*/ }, (args) =>
              args.path in shared ? { path: args.path, namespace: 'host' } : undefined,
            )
            builder.onLoad({ filter: /.*/, namespace: 'host' }, (args) => ({
              contents: `module.exports = SisyphusRuntime.${shared[args.path]}`,
              loader: 'js',
            }))
          } else {
            builder.onLoad({ filter: /\.js$/ }, (args) => {
              if (!args.path.startsWith(entry.folder + path.sep)) return
              return {
                contents: fs
                  .readFileSync(args.path, 'utf8')
                  .replace(/\b__dirname\b/g, JSON.stringify(path.dirname(args.path))),
                loader: 'js',
              }
            })
          }
        },
      },
    ],
    logLevel: 'silent',
  })
  return {
    source: result.outputFiles.find((file) => file.path.endsWith('.js')).text,
    css: result.outputFiles.find((file) => file.path.endsWith('.css'))?.text,
  }
}
function evaluateNative(entry, source, options) {
  const loaded = new Module(entry.file, module)
  loaded.filename = entry.file
  loaded.paths = [...Module._nodeModulePaths(entry.folder), ...module.paths]
  loaded._compile(source, entry.file)
  const factory = loaded.exports.default ?? loaded.exports
  return typeof factory === 'function' ? factory(options) : factory
}
async function createWorker(file) {
  const { Worker } = require('node:worker_threads')
  const built = await compile({ target: 'main', file, folder: path.dirname(file), id: 'worker' })
  // Compile from the editable package, with the same host dependency resolution.
  const bootstrap = `const Module = require('node:module');
    const worker = new Module(${JSON.stringify(file)});
    worker.filename = ${JSON.stringify(file)};
    worker.paths = ${JSON.stringify(module.paths)};
    worker._compile(${JSON.stringify(built.source)}, worker.filename);`
  return new Worker(bootstrap, { eval: true })
}
module.exports = { packages, compile, evaluateNative, filesIn, inside, createWorker, ignoredPath }
