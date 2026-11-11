import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DARK_DIAGRAM_SERIES_COLORS,
  MAIN_CSS_PATH,
  PALETTE_MODULE_PATH,
  PALETTE_TOKEN_NAMES,
  createPaletteModule,
  readTailwindColors,
} from '~~/workers/artifacts-runtime/scripts/theme.mjs'
import { KIT_STYLE } from '~~/workers/artifacts-runtime/src/kit/chrome'
import { paletteDeclarations } from '~~/workers/artifacts-runtime/src/palette'
import { PALETTE_TOKENS } from '~~/workers/artifacts-runtime/src/palette.generated'
import { SHELL_STYLE } from '~~/workers/artifacts-runtime/src/shell'

const KIT_DIRECTORY = path.resolve(
  __dirname,
  '../../../../workers/artifacts-runtime/src/kit',
)

const OLD_BLUE_BLACK_PALETTE = new RegExp([
  '#0d1117', '#151b23', '#ffffff', '#1f2328', '#e6edf3', '#59636e',
  '#9198a1', '#d1d9e0', '#3d444d', '#0969da', '#4493f8', '#cf222e',
  '#ff7b72', '#ffebe9', '#2d1214',
].join('|'), 'i')

const DARK_ONLY_RULE = /[^{}]*data-theme='dark'[^{}]*\{[^}]*\}/g

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}(?![\w-])|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<!--color-)\b(?:slate|gray|grey|zinc|neutral|stone)-\d{2,3}\b/

function readDeclaredNames(css: string): Set<string> {
  return new Set(Array.from(css.matchAll(/(--[a-z0-9-]+):/g), (match) => {
    return match[1]!
  }))
}

function readUsedNames(css: string): Set<string> {
  return new Set(Array.from(css.matchAll(/var\((--[a-z0-9-]+)/g), (match) => {
    return match[1]!
  }))
}

describe('runtime palette from the Besidka theme', () => {
  it('matches main.css and Tailwind: run pnpm run artifacts:theme', () => {
    const generated = readFileSync(PALETTE_MODULE_PATH, 'utf8')
    const mainCss = readFileSync(MAIN_CSS_PATH, 'utf8')

    expect(generated).toBe(createPaletteModule(mainCss, readTailwindColors()))
  })

  it('uses the chat stone palette, not the old blue-black', () => {
    const tailwind = readTailwindColors()

    expect(PALETTE_TOKENS.dark['--color-base-100'])
      .toBe(tailwind.get('--color-stone-800'))
    expect(PALETTE_TOKENS.dark['--color-base-200'])
      .toBe(tailwind.get('--color-stone-900'))
    expect(PALETTE_TOKENS.dark['--color-base-300'])
      .toBe(tailwind.get('--color-stone-950'))
    expect(PALETTE_TOKENS.light['--color-base-200'])
      .toBe(tailwind.get('--color-stone-100'))

    for (const theme of ['light', 'dark'] as const) {
      expect(paletteDeclarations(theme)).not.toMatch(OLD_BLUE_BLACK_PALETTE)
    }
  })

  it('takes the block corner radius from the theme like the chat block', () => {
    const mainCss = readFileSync(MAIN_CSS_PATH, 'utf8')
    const mainRadius = mainCss.match(/--radius-box:\s*([^;]+);/)?.[1]

    for (const theme of ['light', 'dark'] as const) {
      expect(PALETTE_TOKENS[theme]['--radius-box']).toBe(mainRadius)
    }

    expect(KIT_STYLE).toMatch(/\.block \{[^}]*border-radius: var\(--radius-box\)/)
    expect(KIT_STYLE).not.toMatch(/border-radius: 1rem/)
  })

  it('declares the tokens of both themes and the series colours of dark', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(Object.keys(PALETTE_TOKENS[theme]))
        .toEqual(expect.arrayContaining(PALETTE_TOKEN_NAMES))
    }

    expect(Object.keys(PALETTE_TOKENS.dark))
      .toEqual(expect.arrayContaining(DARK_DIAGRAM_SERIES_COLORS))
  })
})

function withoutPalette(css: string): string {
  return ['light', 'dark'].reduce((rest, theme) => {
    return rest.replaceAll(paletteDeclarations(theme as 'light' | 'dark'), '')
  }, css)
}

describe('kit and shell styles use theme variables', () => {
  const kitSources = readdirSync(KIT_DIRECTORY)
    .filter(name => name.endsWith('.ts'))
    .map((name) => {
      return { name, source: readFileSync(path.join(KIT_DIRECTORY, name), 'utf8') }
    })

  it('has no colour literal in the kit styles or the shell styles', () => {
    expect(withoutPalette(KIT_STYLE)).not.toMatch(COLOR_LITERAL)
    expect(withoutPalette(SHELL_STYLE)).not.toMatch(COLOR_LITERAL)
    expect(KIT_STYLE).toContain(paletteDeclarations('dark'))
  })

  it('has no colour literal in any file of the kit', () => {
    for (const { name, source } of kitSources) {
      expect(source.match(COLOR_LITERAL), `${name} has a colour literal`)
        .toBeNull()
    }
  })

  it('only reads variables that both themes declare', () => {
    for (const theme of ['light', 'dark'] as const) {
      const declared = readDeclaredNames(paletteDeclarations(theme))
      const lightStyles = `${KIT_STYLE}${SHELL_STYLE}`
        .replace(DARK_ONLY_RULE, '')
      const styles = theme === 'dark'
        ? `${KIT_STYLE}${SHELL_STYLE}`
        : lightStyles
      const used = [...readUsedNames(styles)].filter((name) => {
        return name.startsWith('--besidka-') || name.startsWith('--color-')
      })

      for (const name of used) {
        expect(declared.has(name), `${name} is not declared in ${theme}`)
          .toBe(true)
      }
    }
  })
})
