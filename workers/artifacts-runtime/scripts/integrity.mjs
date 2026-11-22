import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { findPackageDirectory } from './licenses.mjs'

export const DESIGN_PACKAGES = ['tailwindcss', 'daisyui', '@fontsource/nunito']

export const INTEGRITY_FILE_NAME = 'design-system.integrity.json'

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex')
}

function toInputPath(workerDirectory, input) {
  return path.resolve(workerDirectory, input.replace(/^[a-z-]+:/, ''))
}

/**
 * Hashes every file of the design-system packages that a build bundled
 * (from the esbuild metafile): per package, the sha256 of the sorted list of
 * `<path inside the package> <sha256 of the file>` lines. The digest changes
 * when an upgrade changes any shipped byte, not when unrelated files in the
 * package change.
 */
export function computeDesignIntegrity(metafile, workerDirectory) {
  const filesByPackage = new Map()

  for (const input of Object.keys(metafile.inputs)) {
    if (!input.includes('node_modules')) {
      continue
    }

    const filePath = toInputPath(workerDirectory, input)
    const packageDirectory = findPackageDirectory(filePath)

    if (!packageDirectory) {
      continue
    }

    const manifest = JSON.parse(
      readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'),
    )

    if (!DESIGN_PACKAGES.includes(manifest.name)) {
      continue
    }

    const entry = filesByPackage.get(manifest.name) ?? {
      version: manifest.version,
      lines: [],
    }

    entry.lines.push(
      `${path.relative(packageDirectory, filePath).split(path.sep).join('/')} ${sha256(readFileSync(filePath))}`,
    )
    filesByPackage.set(manifest.name, entry)
  }

  return Object.fromEntries(DESIGN_PACKAGES.map((name) => {
    const entry = filesByPackage.get(name)

    if (!entry) {
      return [name, null]
    }

    const lines = entry.lines.sort()

    return [name, {
      version: entry.version,
      files: lines.length,
      sha256: sha256(lines.join('\n')),
    }]
  }))
}

export function compareDesignIntegrity(actual, expected) {
  const problems = []

  for (const name of DESIGN_PACKAGES) {
    const actualEntry = actual[name]
    const expectedEntry = expected?.[name]

    if (!actualEntry) {
      problems.push(`${name} is not in the build`)

      continue
    }

    if (!expectedEntry) {
      problems.push(`${name} has no recorded digest`)

      continue
    }

    for (const field of ['version', 'files', 'sha256']) {
      if (actualEntry[field] !== expectedEntry[field]) {
        problems.push(`${name} ${field}: recorded ${expectedEntry[field]}, built ${actualEntry[field]}`)
      }
    }
  }

  return problems
}

export function readDesignIntegrity(workerDirectory) {
  const filePath = path.join(workerDirectory, INTEGRITY_FILE_NAME)

  if (!existsSync(filePath)) {
    return null
  }

  return JSON.parse(readFileSync(filePath, 'utf8'))
}

export function writeDesignIntegrity(workerDirectory, integrity) {
  writeFileSync(
    path.join(workerDirectory, INTEGRITY_FILE_NAME),
    `${JSON.stringify(integrity, null, 2)}\n`,
  )
}
