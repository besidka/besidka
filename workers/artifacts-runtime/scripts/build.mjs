#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'
import {
  SHARED_REACT_SPECIFIERS,
  VENDOR_MODULES,
  createImportMap,
  serializeImportMap,
  vendorFileStem,
} from '../src/vendor.ts'
import { SHELL_HEAD } from '../src/shell.ts'
import { createHeadersFile } from './headers.mjs'
import {
  INTEGRITY_FILE_NAME,
  compareDesignIntegrity,
  computeDesignIntegrity,
  readDesignIntegrity,
  writeDesignIntegrity,
} from './integrity.mjs'
import { collectLicenses, renderNotices } from './licenses.mjs'

const isDevelopment = process.argv.includes('--dev')
const shouldUpdateIntegrity = process.argv.includes('--update-integrity')
const workerDirectory = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const distDirectory = path.join(workerDirectory, 'dist')
const versionDirectory = path.join(distDirectory, 'v1')
const assetsDirectory = path.join(versionDirectory, 'assets')
const vendorDirectory = path.join(assetsDirectory, 'vendor')
const entriesDirectory = path.join(workerDirectory, 'node_modules', '.vendor-entries')
const ASSETS_BASE_PATH = '/v1/assets/'
const SHARED_NAMESPACE = 'besidka-shared-react'
const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/
const requireFromWorker = createRequire(path.join(workerDirectory, 'package.json'))
const sharedSpecifierPattern = new RegExp(
  `^(${SHARED_REACT_SPECIFIERS.map(escapeRegExp).join('|')})$`,
)

process.env.NODE_ENV = 'production'

const commonBuildOptions = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022', 'safari16'],
  minify: true,
  legalComments: 'eof',
  metafile: true,
  logLevel: 'warning',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
}

function toAssetPath(outputPath) {
  return path.relative(assetsDirectory, path.join(workerDirectory, outputPath))
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/**
 * Bundles every React-family import of a vendored module as a re-export of
 * the bare specifier, so all vendored modules and artifact code share the one
 * React instance that the import map points at.
 */
function sharedReactPlugin(ownSpecifier) {
  return {
    name: 'besidka-shared-react',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: sharedSpecifierPattern }, (args) => {
        if (args.namespace === SHARED_NAMESPACE) {
          return { path: args.path, external: true }
        }

        const isOwnEntry = args.path === ownSpecifier
          && args.importer.startsWith(entriesDirectory)

        if (isOwnEntry) {
          return undefined
        }

        return { path: args.path, namespace: SHARED_NAMESPACE }
      })

      pluginBuild.onLoad({ filter: /.*/, namespace: SHARED_NAMESPACE }, (args) => {
        const specifier = JSON.stringify(args.path)

        return {
          contents: `export * from ${specifier}\nexport { default } from ${specifier}\n`,
          loader: 'js',
        }
      })
    },
  }
}

/**
 * Mermaid lazy-loads the ELK layout engine (elkjs, EPL-2.0 or GPL-3.0).
 * The runtime ships only permissively licensed code, so that import resolves
 * to a stub that fails with a clear message; diagrams keep the default
 * layout.
 */
function excludeElkLayoutPlugin() {
  return {
    name: 'besidka-exclude-elk',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^elkjs(\/|$)/ }, (args) => {
        return { path: args.path, namespace: 'besidka-excluded' }
      })

      pluginBuild.onLoad({ filter: /.*/, namespace: 'besidka-excluded' }, () => {
        return {
          contents: [
            'export default class UnavailableLayout {',
            '  constructor() {',
            '    throw new Error(\'The ELK diagram layout is not available in Besidka artifacts. Remove the elk layout option to use the default layout.\')',
            '  }',
            '}',
            '',
          ].join('\n'),
          loader: 'js',
        }
      })
    },
  }
}

function createVendorEntrySource(vendorModule) {
  const specifier = JSON.stringify(vendorModule.specifier)

  if (vendorModule.format === 'esm') {
    return `export * from ${specifier}\n`
  }

  const exportedNames = Object.keys(requireFromWorker(vendorModule.specifier))
    .filter((name) => {
      return name !== 'default' && IDENTIFIER_PATTERN.test(name)
    })
    .sort()

  return [
    `import moduleExports from ${specifier}`,
    'export default moduleExports',
    `export const { ${exportedNames.join(', ')} } = moduleExports`,
    '',
  ].join('\n')
}

async function buildVendorModule(vendorModule) {
  const stem = vendorFileStem(vendorModule.specifier)
  const entryPath = path.join(entriesDirectory, `${stem}.js`)

  await writeFile(entryPath, createVendorEntrySource(vendorModule))

  const result = await build({
    ...commonBuildOptions,
    entryPoints: { [stem]: entryPath },
    outdir: vendorDirectory,
    entryNames: '[name]-[hash]',
    absWorkingDir: workerDirectory,
    plugins: [sharedReactPlugin(vendorModule.specifier)],
  })
  const outputFile = Object.keys(result.metafile.outputs).find((output) => {
    return output.endsWith('.js')
  })

  return {
    specifier: vendorModule.specifier,
    file: toAssetPath(outputFile),
    metafile: result.metafile,
  }
}

async function buildRuntime() {
  const result = await build({
    ...commonBuildOptions,
    entryPoints: { main: path.join(workerDirectory, 'src', 'main.ts') },
    outdir: assetsDirectory,
    entryNames: '[name]-[hash]',
    chunkNames: 'chunks/[name]-[hash]',
    assetNames: 'fonts/[name]-[hash]',
    publicPath: ASSETS_BASE_PATH,
    loader: { '.css': 'text', '.woff2': 'file' },
    splitting: true,
    absWorkingDir: workerDirectory,
    external: [...SHARED_REACT_SPECIFIERS],
    plugins: [excludeElkLayoutPlugin()],
  })
  const entryOutput = Object.entries(result.metafile.outputs).find(
    ([, output]) => {
      return output.entryPoint?.endsWith('src/main.ts')
    },
  )

  return {
    file: toAssetPath(entryOutput[0]),
    metafile: result.metafile,
  }
}

function createIndexHtml(importMap, runtimeFile) {
  return [
    '<!doctype html>',
    '<html lang="en" data-theme="light">',
    '<head>',
    SHELL_HEAD,
    `<script type="importmap">${serializeImportMap(importMap)}</script>`,
    `<script type="module" src="${ASSETS_BASE_PATH}${runtimeFile}"></script>`,
    '</head>',
    '<body><div id="root"></div></body>',
    '</html>',
    '',
  ].join('\n')
}

/**
 * Fails the build when the bundled Tailwind, daisyUI or Nunito bytes differ
 * from the digests recorded in design-system.integrity.json, so a version
 * bump of the vendored design system is reviewed (theme, sizes, evals)
 * before it ships. `--update-integrity` records the new digests.
 */
function checkDesignIntegrity(metafile) {
  const actual = computeDesignIntegrity(metafile, workerDirectory)

  if (shouldUpdateIntegrity) {
    writeDesignIntegrity(workerDirectory, actual)
    console.log(`Recorded design-system digests in ${INTEGRITY_FILE_NAME}`)

    return
  }

  const problems = compareDesignIntegrity(
    actual,
    readDesignIntegrity(workerDirectory),
  )

  if (problems.length === 0) {
    return
  }

  for (const problem of problems) {
    console.error(`Design system integrity: ${problem}`)
  }

  console.error('Review the change (docs/artifacts-runtime.md "Design system"), then run: pnpm --filter artifacts-runtime build --update-integrity')
  process.exit(1)
}

async function listFiles(directory) {
  const entries = await readdir(directory, {
    withFileTypes: true,
    recursive: true,
  })

  return entries.filter((entry) => {
    return entry.isFile()
  }).map((entry) => {
    return path.join(entry.parentPath, entry.name)
  })
}

async function printBundleReport() {
  const files = await listFiles(assetsDirectory)
  let totalBytes = 0
  let totalGzipBytes = 0
  let initialGzipBytes = 0
  const rows = []

  for (const file of files) {
    const contents = await readFile(file)
    const gzipBytes = gzipSync(contents).length
    const relativePath = path.relative(assetsDirectory, file)

    totalBytes += contents.length
    totalGzipBytes += gzipBytes

    if (relativePath.startsWith('main-')) {
      initialGzipBytes += gzipBytes
    }

    rows.push({ relativePath, bytes: contents.length, gzipBytes })
  }

  rows.sort((first, second) => {
    return second.gzipBytes - first.gzipBytes
  })

  console.log('\nLargest runtime assets (gzip):')

  for (const row of rows.slice(0, 12)) {
    console.log(`  ${(row.gzipBytes / 1024).toFixed(1).padStart(8)} KiB  ${row.relativePath}`)
  }

  console.log(`\nAssets: ${files.length} files, ${(totalBytes / 1024).toFixed(1)} KiB raw, ${(totalGzipBytes / 1024).toFixed(1)} KiB gzip in total`)
  console.log(`Runtime entry (loaded for every artifact): ${(initialGzipBytes / 1024).toFixed(1)} KiB gzip`)
}

async function main() {
  await rm(distDirectory, { recursive: true, force: true })
  await mkdir(vendorDirectory, { recursive: true })
  await mkdir(entriesDirectory, { recursive: true })

  const vendorResults = []

  for (const vendorModule of VENDOR_MODULES) {
    vendorResults.push(await buildVendorModule(vendorModule))
  }

  const runtimeResult = await buildRuntime()
  const manifest = Object.fromEntries(vendorResults.map((vendorResult) => {
    return [vendorResult.specifier, vendorResult.file]
  }))
  const importMap = createImportMap(manifest, ASSETS_BASE_PATH)
  const { entries, disallowed } = collectLicenses(
    [...vendorResults.map((vendorResult) => {
      return vendorResult.metafile
    }), runtimeResult.metafile],
    workerDirectory,
  )

  if (disallowed.length > 0) {
    for (const entry of disallowed) {
      console.error(`Licence not allowed: ${entry.name}@${entry.version} (${entry.declaredLicense})`)
    }

    process.exit(1)
  }

  checkDesignIntegrity(runtimeResult.metafile)

  const withoutLicenseText = entries.filter((entry) => {
    return !entry.licenseText
  })

  for (const entry of withoutLicenseText) {
    console.warn(`No licence file shipped: ${entry.name}@${entry.version} (${entry.chosenLicense}); the notice names the licence only`)
  }

  await writeFile(
    path.join(versionDirectory, 'index.html'),
    createIndexHtml(importMap, runtimeResult.file),
  )
  await writeFile(
    path.join(versionDirectory, 'THIRD_PARTY_NOTICES.txt'),
    renderNotices(entries),
  )
  await writeFile(
    path.join(distDirectory, '_headers'),
    createHeadersFile({ dev: isDevelopment }),
  )

  const noticesSize = (await stat(path.join(versionDirectory, 'THIRD_PARTY_NOTICES.txt'))).size

  console.log(`Built artifacts runtime (${isDevelopment ? 'development' : 'production'} headers)`)
  console.log(`Third-party packages: ${entries.length}, notices ${(noticesSize / 1024).toFixed(1)} KiB, licences: ${[...new Set(entries.map((entry) => {
    return entry.chosenLicense
  }))].sort().join(', ')}`)

  await printBundleReport()
}

await main()
