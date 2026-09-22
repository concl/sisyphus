const path = require('node:path')
const { PluginArtifacts } = require('./lib/plugin-artifacts')
const { PluginLoader } = require('./lib/plugin-loader')
const { createWorker } = require('./lib/plugin-compiler')

// The host knows how to load packages, never which features a build contains.
module.exports = async (options) => {
  const directory = path.join(options.userData, 'plugins')
  const artifacts = new PluginArtifacts({ shippedDir: options.shippedPlugins, directory })
  artifacts.seed()
  const loader = new PluginLoader(directory, {
    manifest: artifacts.available ? artifacts.manifest() : null,
    options: { ...options, preload: path.join(__dirname, 'preload.js') },
  })
  loader.ensure()
  await loader.prepare()
  const loaded = await loader.loadAll()
  const plugins = []
  for (const result of loaded) {
    if (result.error) console.error(`[plugins] ${result.id}: ${result.error}`)
    else plugins.push(result.plugin)
  }
  return [{ id: 'platform.workers', provide: ['runtime.workers.v1'],
    apply(ctx) { ctx.provide('runtime.workers.v1', { create: createWorker }) } },
    ...plugins, require('./plugins/plugin-loader')({ ...options, loader, artifacts, loaded })]
}
