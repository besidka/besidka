import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { compile } from 'tailwindcss'
import daisyui from 'daisyui'
import daisyuiTheme from 'daisyui/theme'
import {
  DAISYUI_TOKENS,
  MAIN_CSS_PATH,
  THEME_MODULE_PATH,
  createThemeModule,
  extractThemes,
} from '~~/workers/artifacts-runtime/scripts/theme.mjs'
import {
  DESIGN_PACKAGES,
  compareDesignIntegrity,
  readDesignIntegrity,
} from '~~/workers/artifacts-runtime/scripts/integrity.mjs'
import {
  BESIDKA_COMPONENT_OVERRIDES,
  createDesignInputCss,
} from '~~/workers/artifacts-runtime/src/design/stylesheet'
import {
  LAYER_ORDER,
  withLayerOrder,
} from '~~/workers/artifacts-runtime/src/design/layers'
import { SHELL_STYLE } from '~~/workers/artifacts-runtime/src/shell'

const WORKER_DIRECTORY = path.resolve('workers/artifacts-runtime')
const requireFromWorker = createRequire(
  path.join(WORKER_DIRECTORY, 'package.json'),
)
const TEST_FONT_FACES = [
  { weight: 400, unicodeRange: 'U+0000-00FF', url: '/v1/assets/fonts/a.woff2' },
]

function minimalTheme(name: string, extra = '') {
  const tokens = DAISYUI_TOKENS.map((token) => {
    return `  ${token}: 1;`
  }).join('\n')

  return `@plugin "daisyui/theme" {\n  name: "${name}";\n${tokens}\n${extra}}\n`
}

async function compileDesign(candidates: string[]) {
  const indexCss = readFileSync(
    requireFromWorker.resolve('tailwindcss/index.css'),
    'utf8',
  )
  const compiler = await compile(createDesignInputCss(TEST_FONT_FACES), {
    base: '/',
    loadStylesheet: async (id: string, base: string) => {
      expect(id).toBe('tailwindcss')

      return { path: 'index.css', base, content: indexCss }
    },
    loadModule: async (id: string, base: string) => {
      return {
        path: id,
        base,
        module: (id === 'daisyui' ? daisyui : daisyuiTheme) as never,
      }
    },
  })

  return compiler.build(candidates)
}

describe('Besidka theme for artifacts', () => {
  it('matches the daisyUI themes in app/assets/css/main.css', () => {
    const mainCss = readFileSync(MAIN_CSS_PATH, 'utf8')
    const generated = readFileSync(THEME_MODULE_PATH, 'utf8')

    expect(
      generated,
      'main.css theme tokens changed: run pnpm run artifacts:theme',
    ).toBe(createThemeModule(mainCss))
  })

  it('keeps every daisyUI token of the light and dark themes', () => {
    const themes = extractThemes(readFileSync(MAIN_CSS_PATH, 'utf8'))

    expect(themes.map(theme => theme.name)).toEqual(['light', 'dark'])

    for (const theme of themes) {
      const properties = theme.declarations.map(([property]) => property)

      expect(properties).toEqual(expect.arrayContaining(DAISYUI_TOKENS))
    }
  })

  it('refuses a token it does not know and a missing token', () => {
    const themes = minimalTheme('light') + minimalTheme('dark')

    expect(() => {
      extractThemes(themes.replace('}\n', '  --color-new-thing: red;\n}\n'))
    }).toThrow(/Unknown theme token --color-new-thing/)
    expect(() => {
      extractThemes(themes.replace('  --noise: 1;\n', ''))
    }).toThrow(/lacks --noise/)
    expect(() => {
      extractThemes(minimalTheme('light'))
    }).toThrow(/no daisyUI theme named "dark"/)
  })
})

describe('artifact design stylesheet', () => {
  it('ranks the runtime shell below Tailwind and daisyUI', () => {
    expect(SHELL_STYLE.startsWith(`${LAYER_ORDER}\n@layer besidka-shell {`))
      .toBe(true)
    expect(withLayerOrder('.btn{}')).toBe(`${LAYER_ORDER}\n.btn{}`)
    expect(LAYER_ORDER.indexOf('besidka-shell'))
      .toBeLessThan(LAYER_ORDER.indexOf('theme'))
  })

  it('compiles daisyUI components, arbitrary utilities and the theme', async () => {
    const css = await compileDesign([
      'btn',
      'btn-primary',
      'card',
      'card-body',
      'w-[123px]',
      'dark:bg-base-200',
      'not-a-class',
    ])

    expect(css).toContain('.btn-primary')
    expect(css).toContain('.card-body')
    expect(css).toContain('.w-\\[123px\\]')
    expect(css).toContain('[data-theme=dark]')
    expect(css).toContain('[data-theme="dark"]')
    expect(css).toContain('--color-primary: var(--color-stone-800)')
    expect(css).toContain('--color-stone-800:')
    expect(css).toContain('font-family: \'Nunito\'')
    expect(css).toContain('url(\'/v1/assets/fonts/a.woff2\')')
    expect(css).toContain('border-radius: var(--radius-box)')
    expect(css).not.toContain('not-a-class')
    expect(css).not.toMatch(/url\(['"]?https?:/)
    expect(css).not.toMatch(/@import\s/)
  })

  it('mirrors the app-wide component overrides from main.css', () => {
    const mainCss = readFileSync(MAIN_CSS_PATH, 'utf8')

    for (const rule of [
      '--size-selector: .25rem;',
      '--radius-selector: .5rem;',
      '--size-selector: 0.1875rem;',
      ':where(.textarea) {',
      'border-radius: var(--radius-box);',
    ]) {
      expect(mainCss).toContain(rule)
      expect(BESIDKA_COMPONENT_OVERRIDES).toContain(rule)
    }
  })
})

describe('design system integrity', () => {
  const integrity = readDesignIntegrity(WORKER_DIRECTORY)
  const runtimePackage = JSON.parse(
    readFileSync(path.join(WORKER_DIRECTORY, 'package.json'), 'utf8'),
  )

  it('records a digest for every vendored package at its pinned version', () => {
    for (const name of DESIGN_PACKAGES) {
      expect(integrity[name]?.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(integrity[name].version)
        .toBe(runtimePackage.devDependencies[name])
    }
  })

  it('matches the shipped Nunito files byte for byte', () => {
    const systemSource = readFileSync(
      path.join(WORKER_DIRECTORY, 'src/design/system.ts'),
      'utf8',
    )
    const fontFiles = [...systemSource.matchAll(
      /'@fontsource\/nunito\/(files\/[\w-]+\.woff2)'/g,
    )].map(match => match[1] as string)
    const packageDirectory = path.dirname(
      requireFromWorker.resolve('@fontsource/nunito/package.json'),
    )
    const lines = fontFiles.map((file) => {
      const digest = createHash('sha256')
        .update(readFileSync(path.join(packageDirectory, file)))
        .digest('hex')

      return `${file} ${digest}`
    }).sort()
    const digest = createHash('sha256').update(lines.join('\n')).digest('hex')

    expect(fontFiles).toHaveLength(integrity['@fontsource/nunito'].files)
    expect(digest).toBe(integrity['@fontsource/nunito'].sha256)
  })

  it('reports every field that drifted', () => {
    const drifted = {
      ...integrity,
      daisyui: { ...integrity.daisyui, sha256: '0'.repeat(64) },
    }

    expect(compareDesignIntegrity(drifted, integrity)).toEqual([
      expect.stringContaining('daisyui sha256'),
    ])
    expect(compareDesignIntegrity(integrity, null)).toHaveLength(
      DESIGN_PACKAGES.length,
    )
  })
})
