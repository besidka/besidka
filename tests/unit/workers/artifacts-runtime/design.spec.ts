import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { compile } from 'tailwindcss'
import daisyui from 'daisyui'
import daisyuiTheme from 'daisyui/theme'
import {
  ARTIFACT_THEME_OVERRIDES,
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

const TAILWIND_THEME_CSS = readFileSync(
  requireFromWorker.resolve('tailwindcss/theme.css'),
  'utf8',
)

function readThemeToken(themeName: string, token: string): string {
  const theme = extractThemes(readFileSync(MAIN_CSS_PATH, 'utf8'))
    .find(candidate => candidate.name === themeName)
  const declaration = theme?.declarations.find(([property]) => {
    return property === token
  })

  return declaration?.[1] ?? ''
}

function clampChannel(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function relativeLuminance(colourReference: string): number {
  const variable = /^var\((--color-[a-z]+-\d+)\)$/.exec(colourReference)?.[1]
  const pattern = new RegExp(
    `${variable}: oklch\\(([\\d.]+)% ([\\d.]+) ([\\d.]+)\\)`,
  )
  const match = pattern.exec(TAILWIND_THEME_CSS)

  if (!variable || !match) {
    throw new Error(`No Tailwind OKLCH colour for ${colourReference}`)
  }

  const lightness = Number(match[1]) / 100
  const chroma = Number(match[2])
  const hue = Number(match[3]) * Math.PI / 180
  const a = chroma * Math.cos(hue)
  const b = chroma * Math.sin(hue)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3
  const red = clampChannel(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
  )
  const green = clampChannel(
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
  )
  const blue = clampChannel(
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  )

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(first: string, second: string): number {
  const luminances = [relativeLuminance(first), relativeLuminance(second)]
    .sort((left, right) => right - left) as [number, number]

  return (luminances[0] + 0.05) / (luminances[1] + 0.05)
}

const APP_DARK_VALUES_UNDER_OVERRIDE = {
  '--color-primary': 'var(--color-stone-800)',
  '--color-primary-content': 'var(--color-stone-100)',
  '--color-neutral': 'var(--color-stone-800)',
  '--color-neutral-content': 'var(--color-stone-100)',
}

function extractAppDarkTokens(mainCss: string): Record<string, string> {
  const darkBlock = mainCss.slice(mainCss.indexOf('name: "dark"'))
  const tokens: Record<string, string> = {}

  for (const token of Object.keys(APP_DARK_VALUES_UNDER_OVERRIDE)) {
    const match = new RegExp(`${token}:\\s*([^;]+);`).exec(darkBlock)

    tokens[token] = match?.[1]?.trim() ?? ''
  }

  return tokens
}

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

  it('overrides only known dark tokens and keeps the app theme as is', () => {
    const mainCss = readFileSync(MAIN_CSS_PATH, 'utf8')
    const overrides = Object.entries(ARTIFACT_THEME_OVERRIDES.dark)

    expect(Object.keys(ARTIFACT_THEME_OVERRIDES)).toEqual(['dark'])

    for (const [token, value] of overrides) {
      expect(DAISYUI_TOKENS).toContain(token)
      expect(readThemeToken('dark', token)).toBe(value)
    }

    expect(mainCss).toContain('--color-primary: var(--color-stone-800);')
    expect(
      extractAppDarkTokens(mainCss),
      'main.css dark primary or neutral changed: revisit ARTIFACT_THEME_OVERRIDES',
    ).toEqual(APP_DARK_VALUES_UNDER_OVERRIDE)
    expect(readThemeToken('light', '--color-primary'))
      .toBe('var(--color-stone-800)')
    expect(
      createThemeModule(mainCss.replace(
        '--color-primary: var(--color-stone-800);',
        '--color-primary: var(--color-stone-700);',
      )),
    ).not.toBe(createThemeModule(mainCss))
  })

  it('keeps primary and neutral readable in the dark artifact theme', () => {
    const page = readThemeToken('dark', '--color-base-100')
    const primary = readThemeToken('dark', '--color-primary')
    const neutral = readThemeToken('dark', '--color-neutral')

    expect(contrastRatio(
      primary,
      readThemeToken('dark', '--color-primary-content'),
    )).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(primary, page)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(
      neutral,
      readThemeToken('dark', '--color-neutral-content'),
    )).toBeGreaterThanOrEqual(4.5)
    expect(neutral).not.toBe(page)
  })

  it('measures a known Tailwind pair like WCAG does', () => {
    expect(contrastRatio('var(--color-stone-950)', 'var(--color-stone-50)'))
      .toBeGreaterThan(15)
    expect(contrastRatio('var(--color-stone-500)', 'var(--color-stone-500)'))
      .toBe(1)
  })
})

describe('artifact design stylesheet', () => {
  it('ranks the runtime shell below Tailwind and daisyUI', () => {
    expect(SHELL_STYLE.startsWith(`${LAYER_ORDER}\n@layer besidka-shell {`))
      .toBe(true)
    expect(withLayerOrder('.btn{}')).toBe(`${LAYER_ORDER}\n.btn{}`)
    expect(LAYER_ORDER.startsWith('@layer properties, besidka-shell,'))
      .toBe(true)
    expect(LAYER_ORDER.indexOf('besidka-shell'))
      .toBeLessThan(LAYER_ORDER.indexOf('theme'))
    expect(SHELL_STYLE.endsWith('#root {\n  padding: 16px;\n}')).toBe(true)
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
      'outline-color: var(--custom-outline-color, var(--btn-color));',
      '--custom-outline-color: var(--color-neutral-content);',
      '--btn-color: var(--color-neutral-content);',
      'color: color-mix(in oklab, var(--color-base-content) 85%, transparent);',
      ':where([data-theme="dark"]) :is(.label, .fieldset-label) {',
    ]) {
      expect(mainCss).toContain(rule)
      expect(BESIDKA_COMPONENT_OVERRIDES).toContain(rule)
    }
  })

  it('leaves out the dark outline rules that the inverted primary and secondary do not need', () => {
    for (const rule of [
      '--custom-outline-color: var(--color-primary-content);',
      '--btn-color: var(--color-primary-content);',
      '--custom-outline-color: var(--color-secondary-content);',
      '--btn-color: var(--color-secondary-content);',
    ]) {
      expect(readFileSync(MAIN_CSS_PATH, 'utf8')).toContain(rule)
      expect(BESIDKA_COMPONENT_OVERRIDES).not.toContain(rule)
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
