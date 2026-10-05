const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { compile, evaluateNative } = require('../lib/plugin-compiler')

function fixture(t, files, target = 'renderer') {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-assets-'))
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }))
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(folder, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents)
  }
  return { folder, file: path.join(folder, 'index.ts'), id: 'test.assets', target }
}

function evaluate(entry, source) {
  if (entry.target === 'main') return evaluateNative(entry, source)
  let exports
  vm.runInNewContext(source, { SisyphusRuntime: {
    register(id, value) { assert.equal(id, entry.id); exports = value },
    jsx: { jsx: (type, props) => ({ type, props }) },
  } })
  return exports.default
}

function bytes(url) {
  assert.match(url, /^data:/)
  const comma = url.indexOf(',')
  const payload = url.slice(comma + 1).split(/[?#]/)[0]
  return url.slice(0, comma).endsWith(';base64')
    ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload))
}

function cssURLs(css) {
  return [...css.matchAll(/url\(("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^)]*)\)/g)]
    .map(([, value]) => value.replace(/^['"]|['"]$/g, '').replace(/\\(["'\\])/g, '$1'))
}

for (const target of ['renderer', 'main']) {
  test(`${target} imports preserve arbitrary assets as data URLs`, async t => {
    const assets = {
      'font.woff': Buffer.from([0, 255, 1, 128, 2]),
      'font.ttf': Buffer.from([0, 1, 0, 0, 0, 255]),
      'font.woff2': Buffer.from([119, 79, 70, 50, 0, 255]),
      'image.png': Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"><text>"hi" &amp; \'bye\'</text></svg>',
      'model.plugin-owned-format': Buffer.from([255, 0, 128, 7, 10]),
      'document.another-format': 'Any plugin can carry this text.\n',
    }
    const imports = Object.keys(assets).map((name, index) => `import asset${index} from './${name}'`)
    const entry = fixture(t, { ...assets,
      'index.ts': `${imports.join('\n')}\nexport default [${imports.map((_, i) => `asset${i}`).join(',')}]`,
    }, target)
    const result = evaluate(entry, (await compile(entry)).source)
    Object.entries(assets).forEach(([name, original], index) => {
      assert.deepEqual(bytes(result[index]), Buffer.from(original), name)
    })
    assert.match(result[3], /^data:image\/png[;,]/)
    assert.match(result[4], /^data:image\/svg\+xml[;,]/)
  })
}

test('dependency stylesheets inline every local URL and preserve external URLs', async t => {
  const assets = {
    'font.woff': Buffer.from([0, 255, 1, 128, 2]),
    'font.ttf': Buffer.from([0, 1, 0, 0, 0, 255]),
    'font.woff2': Buffer.from([119, 79, 70, 50, 0, 255]),
    'image.svg': '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1"/></svg>',
    'texture.unregistered': Buffer.from([254, 0, 128, 3]),
    'extensionless': Buffer.from([253, 0, 127, 4]),
    'data.json': '{"this":"is an asset in url(), not a module"}',
  }
  const packageFiles = Object.fromEntries(Object.entries(assets).map(([name, value]) => [`node_modules/example/assets/${name}`, value]))
  const entry = fixture(t, {
    ...packageFiles,
    'index.ts': "import 'example/style.css'; export default {}",
    'node_modules/example/package.json': '{"name":"example"}',
    'node_modules/example/style.css': '@import "./nested/fonts.css"; .image { background: url("./assets/image.svg") }',
    'node_modules/example/nested/fonts.css': `
      @font-face { font-family: Example; src: url('../assets/font.woff2') format('woff2'), url('../assets/font.woff') format('woff'), url('../assets/font.ttf') format('truetype'); }
      .custom { background: url('../assets/texture.unregistered?v=1#texture'); }
      .bare { background: url('../assets/extensionless'); }
      .json { background: url('../assets/data.json'); }
      .external { background: url('https://example.com/image.png'); mask: url('data:image/png;base64,AA=='); filter: url('#local'); }
    `,
  })
  const { css } = await compile(entry)
  const urls = cssURLs(css)
  const inlined = urls.filter(url => url.startsWith('data:') && url !== 'data:image/png;base64,AA==')
  assert.equal(inlined.length, Object.keys(assets).length)
  for (const [name, original] of Object.entries(assets)) {
    assert.ok(inlined.some(url => bytes(url).equals(Buffer.from(original))), name)
  }
  assert.ok(urls.includes('https://example.com/image.png'))
  assert.ok(urls.includes('data:image/png;base64,AA=='))
  assert.ok(urls.includes('#local'))
})

test('source languages, extensionless modules, JSON, CSS imports and CSS modules keep their loaders', async t => {
  const sources = {
    'value.js': 'export default 1', 'value.mjs': 'export default 2',
    'value.cjs': 'module.exports = 3', 'value.ts': 'const n: number = 4; export default n',
    'value.mts': 'const n: number = 5; export default n', 'value.cts': 'const n: number = 6; export default n',
    'value.json': '7', 'extensionless': 'module.exports = 8',
    'view.jsx': 'export default <div title="jsx" />',
    'view.tsx': 'const title: string = "tsx"; export default <div title={title} />',
  }
  const imports = Object.keys(sources).map((name, index) => `import value${index} from './${name}'`)
  const entry = fixture(t, { ...sources,
    'index.ts': `${imports.join('\n')}\nimport styles from './style.module.css'; export default { values: [${imports.map((_, i) => `value${i}`).join(',')}], styles }`,
    'style.module.css': '@import "./base.css"; .sample { color: rebeccapurple; }',
    'base.css': 'body { margin: 0; }',
  })
  const built = await compile(entry)
  const result = evaluate(entry, built.source)
  assert.deepEqual(Array.from(result.values.slice(0, 8)), [1, 2, 3, 4, 5, 6, 7, 8])
  assert.equal(result.values[8].props.title, 'jsx')
  assert.equal(result.values[9].props.title, 'tsx')
  assert.match(built.css, new RegExp(`\\.${result.styles.sample} \\{`))
  assert.match(built.css, /margin: 0/)
})

test('missing assets and malformed source remain build errors', async t => {
  const missing = fixture(t, { 'index.ts': "import './style.css'", 'style.css': '.x { background: url(./missing.arbitrary) }' })
  await assert.rejects(compile(missing), /Could not resolve.*missing\.arbitrary/)
  const malformed = fixture(t, { 'index.ts': 'export default ;' })
  await assert.rejects(compile(malformed), /Unexpected/)
})
