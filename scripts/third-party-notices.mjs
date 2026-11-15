import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageDirectory = resolve(repositoryRoot, 'packages/doc-renderer')
const outputPath = resolve(packageDirectory, 'THIRD_PARTY_NOTICES.txt')

export const NOTICE_ENTRY_POINTS = [
  'src/spec/index.ts',
  'src/render/index.ts',
  'src/validate/index.ts',
  'src/stamp/index.ts',
  'src/provenance.ts',
  'src/csv.ts',
].map(entry => resolve(packageDirectory, entry))

const GRAPHS = {
  client: { conditions: ['browser'] },
  worker: { conditions: ['workerd', 'worker', 'browser'] },
}
const STUBBED_BUILTINS = /^node:(?:fs|https)$/
const MIT_TEXT = [
  'Permission is hereby granted, free of charge, to any person obtaining a',
  'copy of this software and associated documentation files (the "Software"),',
  'to deal in the Software without restriction, including without limitation',
  'the rights to use, copy, modify, merge, publish, distribute, sublicense,',
  'and/or sell copies of the Software, and to permit persons to whom the',
  'Software is furnished to do so, subject to the following conditions:',
  '',
  'The above copyright notice and this permission notice shall be included',
  'in all copies or substantial portions of the Software.',
  '',
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
  'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
  'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL',
  'THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR',
  'OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,',
  'ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR',
  'OTHER DEALINGS IN THE SOFTWARE.',
].join('\n')
const LICENSE_FILE_PATTERN = /^(?:licen[cs]e|copying)(?:[.-][a-z]+)?$/i
const LEGAL_COMMENT_PATTERN = /\/\*[!*][\s\S]*?\*\/|\/\*[\s\S]*?(?:@license|@preserve)[\s\S]*?\*\//g

const stubPlugin = {
  name: 'stub-node-builtins',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: STUBBED_BUILTINS }, (args) => {
      return { path: args.path, namespace: 'stub' }
    })
    pluginBuild.onLoad({ filter: /.*/, namespace: 'stub' }, () => {
      return { contents: 'export default {}', loader: 'js' }
    })
  },
}

async function bundleGraph(graph) {
  const result = await build({
    entryPoints: NOTICE_ENTRY_POINTS,
    outdir: resolve(repositoryRoot, '.notices-out'),
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    metafile: true,
    legalComments: 'eof',
    logLevel: 'silent',
    conditions: GRAPHS[graph].conditions,
    plugins: [stubPlugin],
  })

  return {
    code: result.outputFiles.map(file => file.text).join('\n'),
    inputs: Object.keys(result.metafile.inputs),
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function locatePackage(inputPath) {
  const marker = 'node_modules/'
  const markerIndex = inputPath.lastIndexOf(marker)

  if (markerIndex === -1 || inputPath.startsWith('packages/doc-renderer/src')) {
    return null
  }

  const rest = inputPath.slice(markerIndex + marker.length)
  const segments = rest.split('/')
  const name = segments[0].startsWith('@')
    ? `${segments[0]}/${segments[1]}`
    : segments[0]

  if (!name) {
    return null
  }

  return {
    name,
    directory: resolve(
      repositoryRoot,
      inputPath.slice(0, markerIndex + marker.length),
      name,
    ),
  }
}

function readLicenseText(directory) {
  const files = readdirSync(directory).filter((file) => {
    return LICENSE_FILE_PATTERN.test(file)
  })
  const preferred = files.sort()[0]

  return preferred ? readFileSync(resolve(directory, preferred), 'utf8').trim() : null
}

export function findLegalComments(code) {
  return [...code.matchAll(LEGAL_COMMENT_PATTERN)].map(match => match[0].trim())
}

export function inputsWithLegalComments(inputs) {
  const found = []

  for (const input of inputs) {
    const absolute = resolve(repositoryRoot, input)

    if (!existsSync(absolute) || !/\.(?:js|mjs|cjs)$/.test(absolute)) {
      continue
    }

    const comments = findLegalComments(readFileSync(absolute, 'utf8'))

    if (comments.length > 0) {
      found.push({ input, comments })
    }
  }

  return found
}

export async function collectNotices() {
  const packages = new Map()
  const legalComments = new Set()
  const graphs = {}

  for (const graph of Object.keys(GRAPHS)) {
    const bundle = await bundleGraph(graph)

    graphs[graph] = bundle

    for (const input of bundle.inputs) {
      const located = locatePackage(input)

      if (!located || !existsSync(resolve(located.directory, 'package.json'))) {
        continue
      }

      const manifest = readJson(resolve(located.directory, 'package.json'))
      const key = `${manifest.name}@${manifest.version}`
      const entry = packages.get(key) ?? {
        name: manifest.name,
        version: manifest.version,
        license: typeof manifest.license === 'string'
          ? manifest.license
          : (manifest.license?.type ?? 'UNKNOWN'),
        text: readLicenseText(located.directory),
        graphs: new Set(),
      }

      entry.graphs.add(graph)
      packages.set(key, entry)
    }

    for (const comment of findLegalComments(bundle.code)) {
      legalComments.add(comment)
    }
  }

  const inlined = readJson(resolve(packageDirectory, 'notices/inlined.json'))
  const sorted = [...packages.values()].sort((left, right) => {
    return left.name.localeCompare(right.name)
  })
  const sections = []

  sections.push([
    'THIRD-PARTY NOTICES for @besidka/doc-renderer',
    '',
    'Generated by scripts/third-party-notices.mjs from the client and Worker',
    'bundle graphs of packages/doc-renderer. Do not edit by hand: run',
    '"pnpm run notices:documents".',
  ].join('\n'))

  for (const entry of sorted) {
    const header = `${entry.name} ${entry.version} (${entry.license})`
    const graphList = [...entry.graphs].sort().join(', ')

    sections.push([
      '-'.repeat(72),
      header,
      `Bundled in: ${graphList}`,
      '-'.repeat(72),
      entry.text ?? '(no LICENSE file in the package; see the inlined notices below)',
    ].join('\n'))
  }

  sections.push([
    '='.repeat(72),
    'Code and assets inlined in the packages above, or shipped beside them',
    '='.repeat(72),
  ].join('\n'))

  for (const entry of inlined) {
    const lines = ['-'.repeat(72), `${entry.name} (${entry.license})`, '-'.repeat(72)]

    if (entry.note) {
      lines.push(entry.note, '')
    }

    if (entry.statement) {
      lines.push(entry.statement)
    }

    if (entry.copyright) {
      lines.push(entry.copyright, '')
    }

    if (entry.textFile) {
      lines.push(
        readFileSync(resolve(packageDirectory, 'notices', entry.textFile), 'utf8').trim(),
      )
    } else if (entry.license === 'MIT') {
      lines.push(MIT_TEXT)
    }

    sections.push(lines.join('\n'))
  }

  if (legalComments.size > 0) {
    sections.push([
      '='.repeat(72),
      'Legal comments retained from the bundles',
      '='.repeat(72),
      ...[...legalComments].sort(),
    ].join('\n'))
  }

  return {
    text: `${sections.join('\n\n')}\n`,
    packages: sorted,
    graphs,
    legalComments: [...legalComments],
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { text, packages } = await collectNotices()

  writeFileSync(outputPath, text)
  process.stdout.write(`Wrote ${outputPath} (${packages.length} packages)\n`)
}
