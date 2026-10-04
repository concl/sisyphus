const { Scripts } = require('./lib/scripts.js')
module.exports = () => ({
  id: 'desktop.scripts',
  provide: ['scripts.v1'],
  apply(ctx) {
    const scripts = new Scripts()
    ctx.provide('scripts.v1', scripts)
    ctx.effect(() => () => scripts.dispose())
  },
})
