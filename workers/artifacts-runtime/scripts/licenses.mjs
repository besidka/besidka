import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

export const ALLOWED_LICENSES = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'ISC',
  'MIT',
  'Unlicense',
  'Zlib',
])

export const DUAL_LICENSE_CHOICES = {
  '(MPL-2.0 OR Apache-2.0)': 'Apache-2.0',
  'MPL-2.0 OR Apache-2.0': 'Apache-2.0',
  '(MIT OR Apache-2.0)': 'MIT',
  'MIT OR Apache-2.0': 'MIT',
  '(MIT OR CC0-1.0)': 'MIT',
}

export const LICENSE_OVERRIDES = {
  'khroma@2.1.0': 'MIT',
}

const LICENSE_FILE_PATTERN = /^(licen[cs]e|copying|notice)([.-][\w.-]*)?$/i

export function isAllowedLicense(expression) {
  const normalized = expression.replace(/^\((.*)\)$/, '$1').trim()

  if (normalized.includes(' OR ')) {
    return false
  }

  return normalized.split(' AND ').every((license) => {
    return ALLOWED_LICENSES.has(license.trim())
  })
}

function findPackageDirectory(filePath) {
  let directory = path.dirname(filePath)

  while (directory !== path.dirname(directory)) {
    const manifestPath = path.join(directory, 'package.json')

    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

      if (manifest.name && manifest.version) {
        return directory
      }
    }

    directory = path.dirname(directory)
  }

  return null
}

function readLicenseText(packageDirectory) {
  const files = readdirSync(packageDirectory).filter((file) => {
    return LICENSE_FILE_PATTERN.test(file)
  }).sort()

  return files.map((file) => {
    return readFileSync(path.join(packageDirectory, file), 'utf8').trim()
  }).join('\n\n')
}

function normalizeLicense(manifest) {
  if (typeof manifest.license === 'string') {
    return manifest.license
  }

  if (manifest.license && typeof manifest.license.type === 'string') {
    return manifest.license.type
  }

  if (Array.isArray(manifest.licenses)) {
    return manifest.licenses.map((license) => {
      return license.type
    }).join(' OR ')
  }

  return 'UNKNOWN'
}

export function collectLicenses(metafiles, workerDirectory) {
  const packages = new Map()

  for (const metafile of metafiles) {
    for (const input of Object.keys(metafile.inputs)) {
      if (!input.includes('node_modules')) {
        continue
      }

      const filePath = path.resolve(workerDirectory, input.replace(/^[a-z-]+:/, ''))
      const packageDirectory = findPackageDirectory(filePath)

      const isOwnPackage = packageDirectory === path.resolve(workerDirectory)

      if (!packageDirectory || isOwnPackage || packages.has(packageDirectory)) {
        continue
      }

      const manifest = JSON.parse(
        readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'),
      )
      const declaredLicense = LICENSE_OVERRIDES[
        `${manifest.name}@${manifest.version}`
      ] ?? normalizeLicense(manifest)
      const chosenLicense = DUAL_LICENSE_CHOICES[declaredLicense]
        ?? declaredLicense

      packages.set(packageDirectory, {
        name: manifest.name,
        version: manifest.version,
        declaredLicense,
        chosenLicense,
        homepage: manifest.homepage ?? '',
        licenseText: readLicenseText(packageDirectory),
      })
    }
  }

  const entries = [...packages.values()].sort((first, second) => {
    return first.name.localeCompare(second.name)
      || first.version.localeCompare(second.version)
  })
  const disallowed = entries.filter((entry) => {
    return !isAllowedLicense(entry.chosenLicense)
  })

  return { entries, disallowed }
}

export function renderNotices(entries) {
  const header = [
    'Third-party software notices for the Besidka artifacts runtime',
    '',
    'The runtime at /v1/ bundles the open-source packages listed below.',
    'Each entry names the package, its version, the licence it is used',
    'under and the licence text shipped with the package.',
    'Where a package offers a choice of licences, the chosen one is shown.',
  ].join('\n')
  const separator = '='.repeat(72)
  const sections = entries.map((entry) => {
    const licenseLine = entry.declaredLicense === entry.chosenLicense
      ? `License: ${entry.chosenLicense}`
      : `License: ${entry.chosenLicense} (chosen from ${entry.declaredLicense})`
    const text = entry.licenseText
      || `No licence file is shipped with this package. It is licensed under ${entry.chosenLicense}.`

    return [
      separator,
      `${entry.name}@${entry.version}`,
      licenseLine,
      entry.homepage ? `Homepage: ${entry.homepage}` : '',
      '',
      text,
    ].filter((line, index) => {
      return index !== 3 || line !== ''
    }).join('\n')
  })

  return `${header}\n\n${sections.join('\n\n')}\n`
}
