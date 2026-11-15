import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const PACKAGE_ROOT = resolve(
  import.meta.dirname,
  '../../../../packages/doc-renderer',
)
const SOURCE_ROOT = join(PACKAGE_ROOT, 'src')
const ALLOWED_EXTERNAL_IMPORTS = new Set([
  'zod',
  'fflate',
  'pdf-lib',
  '@pdf-lib/fontkit',
  'docx',
  'pptxgenjs',
  'write-excel-file/universal',
])
const PINNED_DEPENDENCIES = {
  '@pdf-lib/fontkit': '1.1.1',
  'docx': '9.15.3',
  'fflate': '0.8.3',
  'pdf-lib': '1.17.1',
  'pptxgenjs': '4.0.1',
  'write-excel-file': '4.1.1',
}
const FORBIDDEN_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ['eval', /\beval\s*\(/],
  ['new Function', /\bnew\s+Function\b/],
  ['Function constructor', /(?<![.\w])Function\s*\(/],
  ['fetch', /(?<![.\w])fetch\s*\(/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['WebSocket', /\bWebSocket\b/],
  ['importScripts', /\bimportScripts\b/],
  ['DOM document', /(?<![.\w/])document\.(?:body|head|cookie|createElement|getElementById|querySelector)/],
  ['DOM window', /(?<![.\w/])window\.(?:location|open|alert|document|addEventListener)/],
  ['DOMParser', /\bDOMParser\b/],
  ['navigator', /(?<![.\w])navigator\./],
  ['localStorage', /\blocalStorage\b/],
  ['useEvent', /\buseEvent\b/],
  ['process.env', /\bprocess\.env\b/],
]

function listSources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)

    return statSync(path).isDirectory()
      ? listSources(path)
      : (path.endsWith('.ts') ? [path] : [])
  })
}

function runtimeImports(source: string): string[] {
  const specifiers: string[] = []
  const pattern = /^\s*(?:import|export)\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/gm

  for (const match of source.matchAll(pattern)) {
    if (!match[1]) {
      specifiers.push(match[2] as string)
    }
  }

  for (const match of source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    specifiers.push(match[1] as string)
  }

  return specifiers
}

function transitiveExternals(entry: string): Set<string> {
  const externals = new Set<string>()
  const visited = new Set<string>()
  const queue = [resolve(PACKAGE_ROOT, entry)]

  while (queue.length > 0) {
    const file = queue.pop() as string

    if (visited.has(file)) {
      continue
    }

    visited.add(file)

    for (const specifier of runtimeImports(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('.')) {
        queue.push(resolve(dirname(file), specifier))
      } else {
        externals.add(specifier)
      }
    }
  }

  return externals
}

const sources = listSources(SOURCE_ROOT)

describe('package boundaries', () => {
  it('has source files to check', () => {
    expect(sources.length).toBeGreaterThan(20)
  })

  it('imports only relative paths and the chosen libraries', () => {
    for (const file of sources) {
      const text = readFileSync(file, 'utf8')
      const allSpecifiers = [
        ...text.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g),
      ].map(match => match[1] as string)

      for (const specifier of allSpecifiers) {
        const isAllowed = specifier.startsWith('.')
          || ALLOWED_EXTERNAL_IMPORTS.has(specifier)

        expect(
          isAllowed,
          `${relative(PACKAGE_ROOT, file)} imports ${specifier}`,
        ).toBe(true)
      }
    }
  })

  it('has no Nuxt, h3, Workers or Node-only imports', () => {
    for (const file of sources) {
      const text = readFileSync(file, 'utf8')

      expect(text, relative(PACKAGE_ROOT, file))
        .not.toMatch(/from\s+['"](?:#|~|nuxt|h3|nitro|vue|cloudflare:|node:)/)
    }
  })

  it('has no eval, dynamic code, network access or DOM use', () => {
    for (const file of sources.filter(path => !path.endsWith('.d.ts'))) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')

      for (const [label, pattern] of FORBIDDEN_PATTERNS) {
        expect(code, `${relative(PACKAGE_ROOT, file)}: ${label}`)
          .not.toMatch(pattern)
      }
    }
  })

  it('type-checks without the DOM lib', () => {
    const tsconfig = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'tsconfig.json'), 'utf8'),
    ) as { compilerOptions: { lib: string[], types: string[] } }

    expect(tsconfig.compilerOptions.lib.join(',')).not.toMatch(/dom/i)
    expect(tsconfig.compilerOptions.types).toEqual([])
  })

  it('pins the libraries chosen by the D-1 spike', () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>
      exports: Record<string, string>
    }

    for (const [name, version] of Object.entries(PINNED_DEPENDENCIES)) {
      expect(manifest.dependencies[name], name).toBe(version)
    }

    expect(Object.keys(manifest.exports)).toEqual(
      expect.arrayContaining([
        './spec',
        './render',
        './validate',
        './provenance',
      ]),
    )
  })

  it('keeps ./spec and ./validate free of the renderer libraries', () => {
    const heavy = ['docx', 'pptxgenjs', 'write-excel-file/universal', 'pdf-lib']

    for (const entry of ['src/spec/index.ts', 'src/validate/index.ts']) {
      const externals = transitiveExternals(entry)

      for (const library of heavy) {
        expect(externals.has(library), `${entry} imports ${library}`).toBe(false)
      }
    }

    expect([...transitiveExternals('src/validate/index.ts')].sort())
      .toEqual(['fflate'])
    expect([...transitiveExternals('src/spec/index.ts')].sort()).toEqual(['zod'])
  })

  it('keeps ./extract free of the renderer libraries and exports it', () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
    ) as { exports: Record<string, string> }

    expect(manifest.exports['./extract']).toBe('./src/extract/index.ts')
    expect([...transitiveExternals('src/extract/index.ts')]).toEqual(['fflate'])
  })

  it('keeps the ZIP summary subpath dependency free', () => {
    expect([...transitiveExternals('src/validate/zip.ts')]).toEqual([])
  })
})
