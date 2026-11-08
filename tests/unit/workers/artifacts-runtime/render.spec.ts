// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { ARTIFACT_KINDS } from '@besidka/artifacts-protocol'
import { RENDERERS, selectRenderer } from '~~/workers/artifacts-runtime/src/render/index'
import { renderMarkdown } from '~~/workers/artifacts-runtime/src/render/markdown'
import { createMermaidConfig } from '~~/workers/artifacts-runtime/src/render/mermaid-config'
import { renderSourcePreview, tailLines } from '~~/workers/artifacts-runtime/src/render/partial'
import {
  DYNAMIC_IMPORT_LABEL,
  describeDisallowedImports,
  findDisallowedImports,
  transpileReactSource,
} from '~~/workers/artifacts-runtime/src/render/react-source'
import { renderSvg } from '~~/workers/artifacts-runtime/src/render/svg'
import { resolveExternalLink } from '~~/workers/artifacts-runtime/src/links'
import {
  ALLOWED_IMPORTS,
  createImportMap,
  serializeImportMap,
  vendorFileStem,
} from '~~/workers/artifacts-runtime/src/vendor'

function createContext() {
  const root = document.createElement('div')

  document.body.replaceChildren(root)

  return { root, theme: 'light' as const, isCurrent: () => true }
}

describe('renderer selection', () => {
  it('has a renderer for every artifact kind', () => {
    expect(Object.keys(RENDERERS).sort()).toEqual([...ARTIFACT_KINDS].sort())
  })

  it('replaces the document only for HTML', () => {
    expect(selectRenderer('html').strategy).toBe('replace-document')

    for (const kind of ['react', 'svg', 'mermaid', 'markdown'] as const) {
      expect(selectRenderer(kind).strategy).toBe('shell')
    }
  })

  it('renders markdown and SVG into the root', async () => {
    const context = createContext()

    await renderMarkdown({
      kind: 'markdown',
      title: 'Doc',
      content: '# Title\n\n- one\n- two',
    }, context)

    expect(context.root.querySelector('article.besidka-markdown h1')?.textContent)
      .toBe('Title')
    expect(context.root.querySelectorAll('li')).toHaveLength(2)

    await renderSvg({
      kind: 'svg',
      title: 'Circle',
      content: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>',
    }, context)

    expect(context.root.querySelector('main.besidka-svg svg circle'))
      .not.toBeNull()
  })

  it('previews partial source as text without running it', () => {
    const context = createContext()

    renderSourcePreview({
      kind: 'html',
      title: 'Draft',
      content: '<script>window.ran = true</script>',
    }, context.root)

    expect(context.root.querySelector('script')).toBeNull()
    expect(context.root.querySelector('pre')?.textContent)
      .toBe('<script>window.ran = true</script>')
    expect(tailLines('1\n2\n3\n4', 2)).toBe('3\n4')
  })

  it('configures mermaid strictly with the permissive dagre layout', () => {
    expect(createMermaidConfig('dark')).toMatchObject({
      securityLevel: 'strict',
      theme: 'dark',
      layout: 'dagre',
      startOnLoad: false,
    })
    expect(createMermaidConfig('light')).toMatchObject({ theme: 'default' })
  })
})

describe('React source handling', () => {
  it('transpiles TSX to an ES module with the automatic JSX runtime', () => {
    const code = transpileReactSource([
      'import { useState } from \'react\'',
      'interface Props { label: string }',
      'export default function App({ label }: Props) {',
      '  const [count] = useState<number>(0)',
      '  return <button>{label} {count}</button>',
      '}',
    ].join('\n'))

    expect(code).toContain('from "react/jsx-runtime"')
    expect(code).toContain('export default function App')
    expect(code).not.toContain('interface Props')
    expect(code).not.toContain('require(')
  })

  it('allows only vendored bare imports', async () => {
    const code = transpileReactSource([
      'import { LineChart } from \'recharts\'',
      'import { Star } from \'lucide-react\'',
      'import pad from \'left-pad\'',
      'import x from \'https://evil.example/x.js\'',
      'import y from \'./local.js\'',
      'const lazy = () => import(\'react-dom\')',
      'const dynamic = (name) => import(name)',
      'export const used = [pad, x, y, lazy, dynamic]',
      'export default () => <LineChart><Star /></LineChart>',
    ].join('\n'))

    expect(await findDisallowedImports(code)).toEqual([
      'left-pad',
      'https://evil.example/x.js',
      './local.js',
      DYNAMIC_IMPORT_LABEL,
    ])
    expect(describeDisallowedImports(['left-pad']))
      .toContain('not available here: left-pad')
  })
})

describe('import map', () => {
  it('maps every allowed specifier to a vendored file', () => {
    const manifest = Object.fromEntries(ALLOWED_IMPORTS.map((specifier) => {
      return [specifier, `vendor/${vendorFileStem(specifier)}-HASH.js`]
    }))
    const importMap = createImportMap(manifest, '/v1/assets/')

    expect(importMap.imports['react-dom/client'])
      .toBe('/v1/assets/vendor/react-dom-client-HASH.js')
    expect(importMap.imports.recharts)
      .toBe('/v1/assets/vendor/recharts-HASH.js')
    expect(Object.values(importMap.imports).every((url) => {
      return url.startsWith('/v1/assets/vendor/')
    })).toBe(true)
    expect(JSON.stringify(importMap)).not.toContain('esm.sh')
  })

  it('fails the build when a vendored module is missing', () => {
    expect(() => {
      createImportMap({ react: 'vendor/react.js' }, '/v1/assets/')
    }).toThrow('Vendored module is missing')
  })

  it('escapes markup when the map is inlined into HTML', () => {
    expect(serializeImportMap({ imports: { a: '</script>' } }))
      .not.toContain('</script>')
  })
})

describe('links', () => {
  it('passes only absolute http(s) links to the host', () => {
    expect(resolveExternalLink('https://example.com/a?b=1'))
      .toBe('https://example.com/a?b=1')
    expect(resolveExternalLink('javascript:alert(1)')).toBeNull()
    expect(resolveExternalLink('/relative')).toBeNull()
    expect(resolveExternalLink(null)).toBeNull()
  })
})
