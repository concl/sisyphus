// Source packages are the runtime unit. Generated code is an in-memory cache.
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { createHash } = require('node:crypto')
const { build } = require('esbuild')

const shared = {
  react: 'react', 'react/jsx-runtime': 'jsx', 'react-dom': 'reactDom',
  'react-dom/client': 'reactDomClient', '@sisyphus/sdk': 'sdk',
  '@sisyphus/profile': 'profile', '@sisyphus/profile/preferences': 'preferences',
  '@sisyphus/ui': 'ui', '@deepseek-ai/cordis': 'cordis',
}
const excluded = new Set(['node_modules', '.git', '.runtime', 'dist', '.venv', '__pycache__', '.pytest_cache'])
const ignoredPath = name => String(name).split(/[\\/]/).some(part => excluded.has(part))
function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (excluded.has(entry.name) || entry.isSymbolicLink()) return []
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? filesIn(file) : entry.isFile() ? [file] : []
  })
}
function inside(directory, relative) {
  const file = path.resolve(directory, relative)
  if (!file.startsWith(path.resolve(directory) + path.sep)) throw new Error('Plugin entry escapes its folder')
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
      const frontend = meta.frontend ?? (meta.entry ? meta : null)
      const backend = meta.backend ?? meta.native ?? []
      if (frontend && (typeof frontend !== 'object' || !frontend.entry))
        throw new Error('sisyphus.frontend must declare an entry')
      if (!Array.isArray(backend)) throw new Error('sisyphus.backend must be an array')
      const entries = [...(frontend ? [{ ...frontend, target: 'renderer' }] : []),
        ...backend.map(entry => ({ ...entry, target: 'main' }))]
      for (const entry of entries) {
        const stamp = createHash('sha256').update(files.filter(file => {
          const relative = path.relative(folder, file).replaceAll('\\', '/')
          // UI edits must not restart native jobs in the same feature package.
          if (entry.target === 'renderer')
            return !['native/', 'backend/', 'worker/', 'service/'].some(prefix => relative.startsWith(prefix))
          const separateBackend = /^\.\/(native|backend)\//.test(entry.entry)
          return !separateBackend || !['src/', 'frontend/'].some(prefix => relative.startsWith(prefix))
        }).map(file => {
          const stat = fs.statSync(file)
          return `${path.relative(folder, file)}:${stat.mtimeMs}:${stat.size}`
        }).join('|')).digest('hex')
        if (!/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/.test(entry.id)) throw new Error('Invalid plugin id')
        result.push({ ...entry, file: inside(folder, entry.entry), folder, package: child.name,
          format: 'source', mtime: stamp, export: entry.export ?? 'default' })
      }
    } catch (error) {
      result.push({ id: child.name, target: null, folder, file: manifest, error: error.message })
    }
  }
  return result
}

async function compile(entry) {
  const renderer = entry.target === 'renderer'
  const result = await build({
    absWorkingDir: entry.folder, entryPoints: [entry.file], bundle: true, write: false,
    outfile: path.join(entry.folder, '.runtime', `${entry.id}.js`),
    platform: renderer ? 'browser' : 'node', format: renderer ? 'iife' : 'cjs',
    globalName: renderer ? '__sisyphusPlugin' : undefined, target: 'es2022',
    jsx: 'automatic', loader: { '.svg': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl' },
    nodePaths: require.resolve.paths('react'),
    external: renderer ? [] : ['electron', 'node-pty', '@modelcontextprotocol/server-filesystem', '@modelcontextprotocol/server-filesystem/*'],
    define: renderer ? { 'process.env.NODE_ENV': '"production"', global: 'globalThis' } : {},
    footer: renderer ? { js: `SisyphusRuntime.register(${JSON.stringify(entry.id)}, __sisyphusPlugin);` } : {},
    plugins: [{ name: 'host-contracts', setup(builder) {
      builder.onLoad({ filter: /\.svg$/ }, args => ({
        contents: `export default ${JSON.stringify(`data:image/svg+xml;base64,${fs.readFileSync(args.path).toString('base64')}`)}`,
        loader: 'js',
      }))
      if (renderer) {
        builder.onResolve({ filter: /.*/ }, args => args.path in shared ? { path: args.path, namespace: 'host' } : undefined)
        builder.onLoad({ filter: /.*/, namespace: 'host' }, args => ({ contents: `module.exports = SisyphusRuntime.${shared[args.path]}`, loader: 'js' }))
      } else {
        builder.onLoad({ filter: /\.js$/ }, args => {
          if (!args.path.startsWith(entry.folder + path.sep)) return
          return { contents: fs.readFileSync(args.path, 'utf8').replace(/\b__dirname\b/g, JSON.stringify(path.dirname(args.path))), loader: 'js' }
        })
      }
    }}],
    logLevel: 'silent',
  })
  return { source: result.outputFiles.find(file => file.path.endsWith('.js')).text,
    css: result.outputFiles.find(file => file.path.endsWith('.css'))?.text }
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
