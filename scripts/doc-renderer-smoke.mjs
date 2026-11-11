import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = resolve(repositoryRoot, 'packages/doc-renderer')
const fixtureRoot = resolve(repositoryRoot, 'tests/fixtures/documents/reference')
const outputRoot = join(tmpdir(), 'doc-renderer-smoke')
const CASES = [
  { name: 'report', spec: 'report.json' },
  { name: 'report-pdf', spec: 'report-pdf.json' },
  { name: 'deck', spec: 'deck.json' },
  { name: 'workbook', spec: 'workbook.json' },
]
const FORMAT_ENTRIES = {
  docx: 'renderDocx',
  pptx: 'renderPptx',
  xlsx: 'renderXlsx',
  pdf: 'renderPdf',
}
const CONTENT_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
}

const stubPlugin = {
  name: 'stub-node-builtins',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^node:(?:fs|https)$/ }, (args) => {
      return { path: args.path, namespace: 'stub' }
    })
    pluginBuild.onLoad({ filter: /.*/, namespace: 'stub' }, () => {
      return { contents: 'export default {}', loader: 'js' }
    })
  },
}

async function bundle(options) {
  return build({
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    logLevel: 'silent',
    plugins: [stubPlugin],
    ...options,
  })
}

async function measureChunks() {
  const sizes = {}

  for (const [format, symbol] of Object.entries(FORMAT_ENTRIES)) {
    const result = await bundle({
      stdin: {
        contents: `export { ${symbol} } from './src/render/${format}.ts'`,
        resolveDir: packageRoot,
        loader: 'ts',
      },
    })
    const code = result.outputFiles[0].contents

    sizes[format] = {
      minifiedKiB: Number((code.length / 1024).toFixed(1)),
      gzipKiB: Number((gzipSync(code).length / 1024).toFixed(1)),
    }
  }

  const validate = await bundle({
    stdin: {
      contents: 'export { validate } from \'./src/validate/index.ts\'',
      resolveDir: packageRoot,
      loader: 'ts',
    },
  })
  const spec = await bundle({
    stdin: {
      contents: 'export { parseDocumentSpec } from \'./src/spec/index.ts\'',
      resolveDir: packageRoot,
      loader: 'ts',
    },
  })

  for (const [label, result] of [['validate', validate], ['spec', spec]]) {
    const code = result.outputFiles[0].contents

    sizes[label] = {
      minifiedKiB: Number((code.length / 1024).toFixed(1)),
      gzipKiB: Number((gzipSync(code).length / 1024).toFixed(1)),
    }
  }

  return sizes
}

function startServer(root) {
  const routes = new Map()

  routes.set('/', {
    type: '.html',
    body: '<!doctype html><meta charset="utf-8"><title>doc-renderer smoke</title>',
  })
  routes.set('/worker.js', {
    type: '.js',
    body: readFileSync(join(root, 'worker.js')),
  })

  for (const entry of CASES) {
    routes.set(`/fixtures/${entry.spec}`, {
      type: '.json',
      body: readFileSync(join(fixtureRoot, entry.spec)),
    })
  }

  for (const image of ['chart-revenue.png', 'chart-regions.png']) {
    routes.set(`/fixtures/${image}`, {
      type: '.png',
      body: readFileSync(join(fixtureRoot, image)),
    })
  }

  for (const font of ['Regular', 'Bold', 'Italic']) {
    routes.set(`/fonts/NotoSans-${font}.ttf`, {
      type: '.ttf',
      body: readFileSync(join(packageRoot, `fonts/NotoSans-${font}.ttf`)),
    })
  }

  const server = createServer((request, response) => {
    const route = routes.get(request.url ?? '/')

    if (!route) {
      response.writeHead(404).end()

      return
    }

    response.writeHead(200, { 'content-type': CONTENT_TYPES[route.type] })
    response.end(route.body)
  })

  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => resolveServer(server))
  })
}

async function runInBrowser(origin) {
  const browser = await chromium.launch({ headless: true })

  try {
    const page = await browser.newPage()

    await page.goto(origin)

    return await page.evaluate(async (cases) => {
      const worker = new Worker('/worker.js', { type: 'module' })
      const load = async path => (await fetch(path)).arrayBuffer()
      const fonts = {
        regular: await load('/fonts/NotoSans-Regular.ttf'),
        bold: await load('/fonts/NotoSans-Bold.ttf'),
        italic: await load('/fonts/NotoSans-Italic.ttf'),
      }
      const images = {
        'chart-revenue.png': await load('/fixtures/chart-revenue.png'),
        'chart-regions.png': await load('/fixtures/chart-regions.png'),
      }
      const results = []

      for (const entry of cases) {
        const spec = await (await fetch(`/fixtures/${entry.spec}`)).json()
        const message = await new Promise((resolveMessage, rejectMessage) => {
          worker.onmessage = event => resolveMessage(event.data)
          worker.onerror = event => rejectMessage(new Error(event.message))
          worker.postMessage({
            name: entry.name,
            spec,
            fonts: {
              regular: fonts.regular.slice(0),
              bold: fonts.bold.slice(0),
              italic: fonts.italic.slice(0),
            },
            images: {
              'chart-revenue.png': images['chart-revenue.png'].slice(0),
              'chart-regions.png': images['chart-regions.png'].slice(0),
            },
          })
        })

        results.push({
          ...message,
          bytes: message.bytes
            ? Array.from(new Uint8Array(message.bytes))
            : null,
        })
      }

      worker.terminate()

      return results
    }, CASES)
  } finally {
    await browser.close()
  }
}

async function renderInNode(entry) {
  const { parseDocumentSpec } = await import('../packages/doc-renderer/src/spec/index.ts')
  const { render } = await import('../packages/doc-renderer/src/render/index.ts')
  const spec = JSON.parse(readFileSync(join(fixtureRoot, entry.spec), 'utf8'))
  const parsed = parseDocumentSpec(spec)

  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.issues))
  }

  const read = path => new Uint8Array(readFileSync(path))
  const assets = new Map([
    ['chart-revenue.png', { bytes: read(join(fixtureRoot, 'chart-revenue.png')), mediaType: 'image/png' }],
    ['chart-regions.png', { bytes: read(join(fixtureRoot, 'chart-regions.png')), mediaType: 'image/png' }],
  ])

  return render(parsed.spec, assets, {
    fonts: {
      regular: read(join(packageRoot, 'fonts/NotoSans-Regular.ttf')),
      bold: read(join(packageRoot, 'fonts/NotoSans-Bold.ttf')),
      italic: read(join(packageRoot, 'fonts/NotoSans-Italic.ttf')),
    },
  })
}

mkdirSync(outputRoot, { recursive: true })

const workerBundle = await bundle({
  entryPoints: [join(packageRoot, 'smoke/worker.js')],
  outfile: join(outputRoot, 'worker.js'),
})

writeFileSync(join(outputRoot, 'worker.js'), workerBundle.outputFiles[0].contents)

const sizes = await measureChunks()
const server = await startServer(outputRoot)
const origin = `http://127.0.0.1:${server.address().port}`
let failed = false

try {
  const results = await runInBrowser(origin)

  for (const result of results) {
    if (result.error) {
      failed = true
      process.stdout.write(`FAIL ${result.name}: ${result.error}\n`)
      continue
    }

    const browserBytes = Uint8Array.from(result.bytes)
    const nodeResult = await renderInNode(
      CASES.find(entry => entry.name === result.name),
    )
    const isIdentical = Buffer.compare(
      Buffer.from(browserBytes),
      Buffer.from(nodeResult.bytes),
    ) === 0
    const validation = result.validation

    if (!validation.ok || validation.provenance !== 'ai') {
      failed = true
    }

    process.stdout.write(
      `${validation.ok ? 'ok  ' : 'FAIL'} ${result.name}.${result.extension}`
      + ` ${browserBytes.length} bytes, ${Math.round(result.elapsed)} ms in the Worker,`
      + ` provenance ${validation.provenance ?? validation.code},`
      + ` ${isIdentical ? 'byte-identical to Node' : 'differs from Node'}\n`,
    )
  }
} finally {
  server.close()
}

process.stdout.write(`${JSON.stringify(sizes, null, 2)}\n`)

if (failed) {
  process.exit(1)
}
