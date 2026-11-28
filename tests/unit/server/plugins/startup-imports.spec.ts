import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const EAGER_DIRECTORIES = ['server/plugins', 'server/middleware']
const HEAVY_MODULES = [
  'server/utils/google/access-ended.ts',
  'server/utils/google/sheets-api.ts',
  'server/utils/google/sheets-grid.ts',
  'server/utils/google/sheets-model.ts',
  'server/utils/google/sheets-read.ts',
]
const HEAVY_PACKAGE_SPECIFIERS = ['@besidka/doc-renderer/workbook-map']
const RESOLVE_SUFFIXES = ['', '.ts', '/index.ts']
const IMPORT_PATTERN
  = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s+['"]([^'"]+)['"]/g
const SIDE_EFFECT_IMPORT_PATTERN = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g
const INLINE_TYPE_SPECIFIER_PATTERN = /^type\s+/

function listEntryFiles(): string[] {
  return EAGER_DIRECTORIES.flatMap((directory) => {
    return readdirSync(join(ROOT, directory))
      .filter(name => name.endsWith('.ts'))
      .map(name => join(ROOT, directory, name))
  })
}

function isTypeOnlyClause(clause: string): boolean {
  const named = clause.match(/^\{([\s\S]*)\}$/)

  if (!named) {
    return false
  }

  const specifiers = named[1]!
    .split(',')
    .map(specifier => specifier.trim())
    .filter(Boolean)

  return specifiers.length > 0 && specifiers.every((specifier) => {
    return INLINE_TYPE_SPECIFIER_PATTERN.test(specifier)
  })
}

function readStaticSpecifiers(source: string): string[] {
  const specifiers: string[] = []

  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const isTypeStatement = Boolean(match[2])

    if (isTypeStatement || isTypeOnlyClause(match[3]!.trim())) {
      continue
    }

    specifiers.push(match[4]!)
  }

  for (const match of source.matchAll(SIDE_EFFECT_IMPORT_PATTERN)) {
    specifiers.push(match[1]!)
  }

  return specifiers
}

function resolveSpecifier(specifier: string, from: string): string | null {
  let base: string

  if (specifier.startsWith('~~/')) {
    base = join(ROOT, specifier.slice(3))
  } else if (specifier.startsWith('#shared/')) {
    base = join(ROOT, 'shared', specifier.slice(8))
  } else if (specifier.startsWith('.')) {
    base = resolve(dirname(from), specifier)
  } else {
    return null
  }

  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = `${base}${suffix}`

    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate
    }
  }

  return null
}

interface StaticGraph {
  files: Map<string, string | null>
  packages: Map<string, string>
}

function walkStaticImports(entry: string): StaticGraph {
  const files = new Map<string, string | null>([[entry, null]])
  const packages = new Map<string, string>()
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.shift()!
    const specifiers = readStaticSpecifiers(readFileSync(file, 'utf8'))

    for (const specifier of specifiers) {
      if (HEAVY_PACKAGE_SPECIFIERS.includes(specifier)) {
        packages.set(specifier, file)

        continue
      }

      const resolved = resolveSpecifier(specifier, file)

      if (!resolved || files.has(resolved)) {
        continue
      }

      files.set(resolved, file)
      queue.push(resolved)
    }
  }

  return { files, packages }
}

function describeChain(graph: StaticGraph, target: string): string {
  const chain: string[] = []
  let cursor: string | null | undefined = target

  while (cursor) {
    chain.unshift(relative(ROOT, cursor))
    cursor = graph.files.get(cursor)
  }

  return chain.join(' -> ')
}

function heavyReaches(entry: string): string[] {
  const graph = walkStaticImports(entry)
  const reached: string[] = []

  for (const heavy of HEAVY_MODULES) {
    const absolute = join(ROOT, heavy)

    if (graph.files.has(absolute)) {
      reached.push(describeChain(graph, absolute))
    }
  }

  for (const [specifier, importer] of graph.packages) {
    reached.push(`${describeChain(graph, importer)} -> ${specifier}`)
  }

  return reached
}

describe('startup import graph of eager server entries', () => {
  it('finds the workbook map when a file imports it statically', () => {
    const reached = heavyReaches(
      join(ROOT, 'server/utils/google/sheets-read.ts'),
    )

    expect(reached.some((chain) => {
      return chain.endsWith('@besidka/doc-renderer/workbook-map')
    })).toBe(true)
  })

  it('keeps the file conversion free of a static workbook map import', () => {
    const source = readFileSync(
      join(ROOT, 'server/utils/files/convert-files-for-ai.ts'),
      'utf8',
    )

    expect(readStaticSpecifiers(source)).not.toContain(
      '@besidka/doc-renderer/workbook-map',
    )
  })

  it('does not import access-ended directly in the Google sweep', () => {
    const source = readFileSync(
      join(ROOT, 'server/plugins/google-access-sweep.ts'),
      'utf8',
    )

    expect(readStaticSpecifiers(source).join('\n')).not.toMatch(
      /access-ended|workbook-map/,
    )
  })

  it.each(listEntryFiles().map((file) => {
    return [relative(ROOT, file), file]
  }))('%s reaches no heavy module at startup', (_name, file) => {
    expect(heavyReaches(file)).toEqual([])
  })
})
