import { init, parse } from 'es-module-lexer/minimal/js'
import { transform } from 'sucrase'
import { ALLOWED_IMPORTS } from '../vendor.ts'

const IMPORT_META = -2

export const DYNAMIC_IMPORT_LABEL = 'import(<expression>)'

export function transpileReactSource(source: string): string {
  return transform(source, {
    transforms: ['jsx', 'typescript'],
    jsxRuntime: 'automatic',
    production: true,
    filePath: 'artifact.tsx',
  }).code
}

/**
 * Lists every import of the transpiled module that the runtime cannot serve:
 * anything outside the vendored allowlist, URLs, relative paths and dynamic
 * imports of computed specifiers. A non-empty result stops the render before
 * the module is loaded, so no request is made for a rejected import.
 */
export async function findDisallowedImports(code: string): Promise<string[]> {
  await init()

  const [imports] = parse(code)
  const disallowed = new Set<string>()

  for (const entry of imports) {
    if (entry.d === IMPORT_META) {
      continue
    }

    if (entry.n === undefined) {
      disallowed.add(DYNAMIC_IMPORT_LABEL)

      continue
    }

    if (!ALLOWED_IMPORTS.includes(entry.n)) {
      disallowed.add(entry.n)
    }
  }

  return [...disallowed]
}

export function describeDisallowedImports(specifiers: string[]): string {
  return [
    `This artifact imports modules that are not available here: ${specifiers.join(', ')}.`,
    `Available modules: ${ALLOWED_IMPORTS.join(', ')}.`,
    'Nothing was loaded.',
  ].join(' ')
}
