export interface VendorModule {
  specifier: string
  format: 'cjs' | 'esm'
}

export const SHARED_REACT_SPECIFIERS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
] as const

export const VENDOR_MODULES: readonly VendorModule[] = [
  { specifier: 'react', format: 'cjs' },
  { specifier: 'react/jsx-runtime', format: 'cjs' },
  { specifier: 'react-dom', format: 'cjs' },
  { specifier: 'react-dom/client', format: 'cjs' },
  { specifier: 'recharts', format: 'esm' },
  { specifier: 'lucide-react', format: 'esm' },
]

export const ALLOWED_IMPORTS: readonly string[] = VENDOR_MODULES.map(
  (vendorModule) => {
    return vendorModule.specifier
  },
)

export type ImportMapManifest = Record<string, string>

export interface ImportMap {
  imports: Record<string, string>
}

export function vendorFileStem(specifier: string): string {
  return specifier.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
}

export function createImportMap(
  manifest: ImportMapManifest,
  basePath: string,
): ImportMap {
  const imports: Record<string, string> = {}

  for (const specifier of ALLOWED_IMPORTS) {
    const file = manifest[specifier]

    if (!file) {
      throw new Error(`Vendored module is missing from the build: ${specifier}`)
    }

    imports[specifier] = `${basePath}${file}`
  }

  return { imports }
}

export function serializeImportMap(importMap: ImportMap): string {
  return JSON.stringify(importMap).replace(/</g, '\\u003c')
}
