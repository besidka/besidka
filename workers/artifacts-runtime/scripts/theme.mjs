#!/usr/bin/env node

/* eslint-disable no-console */

import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const workerDirectory = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

export const MAIN_CSS_PATH = path.resolve(
  workerDirectory,
  '../../app/assets/css/main.css',
)

export const THEME_MODULE_PATH = path.join(
  workerDirectory,
  'src/design/theme.generated.ts',
)

export const PALETTE_MODULE_PATH = path.join(
  workerDirectory,
  'src/palette.generated.ts',
)

export const THEME_NAMES = ['light', 'dark']

export const PALETTE_TOKENS = [
  '--color-base-100',
  '--color-base-200',
  '--color-base-300',
  '--color-base-content',
  '--color-accent',
  '--color-info',
  '--color-success',
  '--color-warning',
  '--color-error',
]

export const DARK_DIAGRAM_SERIES_COLORS = [
  '--color-pink-300',
  '--color-sky-400',
  '--color-emerald-300',
  '--color-amber-300',
  '--color-red-400',
  '--color-stone-100',
  '--color-violet-400',
  '--color-lime-400',
]

export const THEME_SETTINGS = ['name', 'default', 'prefersdark', 'color-scheme']

export const DAISYUI_TOKENS = [
  '--color-base-100',
  '--color-base-200',
  '--color-base-300',
  '--color-base-content',
  '--color-primary',
  '--color-primary-content',
  '--color-secondary',
  '--color-secondary-content',
  '--color-accent',
  '--color-accent-content',
  '--color-neutral',
  '--color-neutral-content',
  '--color-info',
  '--color-info-content',
  '--color-success',
  '--color-success-content',
  '--color-warning',
  '--color-warning-content',
  '--color-error',
  '--color-error-content',
  '--radius-selector',
  '--radius-field',
  '--radius-box',
  '--size-selector',
  '--size-field',
  '--border',
  '--depth',
  '--noise',
]

export const APP_ONLY_TOKENS = [
  '--color-accent-bg',
  '--color-accent-text',
  '--color-input-success',
  '--color-text',
  '--color-skeleton',
  '--color-skeleton-overlay',
  '--color-logo-eyes-bg',
]

/**
 * Artifact-only token values that replace the main.css ones. In the app's
 * dark theme primary and neutral equal the page colour (stone-800), which
 * works on the app's glass surfaces but hides `btn-primary`, `bg-primary`
 * and `badge-neutral` on an artifact's plain base-100 page. Dark primary is
 * inverted the way light works (a light fill with dark text) and neutral is
 * lifted one step. The app theme stays as it is.
 */
export const ARTIFACT_THEME_OVERRIDES = {
  dark: {
    '--color-primary': 'var(--color-stone-100)',
    '--color-primary-content': 'var(--color-stone-800)',
    '--color-neutral': 'var(--color-stone-700)',
    '--color-neutral-content': 'var(--color-stone-100)',
  },
}

const THEME_BLOCK_START = '@plugin "daisyui/theme" {'

function readThemeBlocks(mainCss) {
  const blocks = []
  let searchFrom = 0

  while (true) {
    const start = mainCss.indexOf(THEME_BLOCK_START, searchFrom)

    if (start === -1) {
      return blocks
    }

    const bodyStart = start + THEME_BLOCK_START.length
    const end = mainCss.indexOf('}', bodyStart)

    if (end === -1) {
      throw new Error('Unclosed @plugin "daisyui/theme" block in main.css')
    }

    blocks.push(mainCss.slice(bodyStart, end))
    searchFrom = end + 1
  }
}

function parseDeclarations(body) {
  const declarations = new Map()

  for (const rawLine of body.split(';')) {
    const line = rawLine.replace(/\/\*[\s\S]*?\*\//g, '').trim()

    if (!line) {
      continue
    }

    const separator = line.indexOf(':')

    if (separator === -1) {
      throw new Error(`Cannot parse theme declaration "${line}"`)
    }

    declarations.set(
      line.slice(0, separator).trim(),
      line.slice(separator + 1).trim(),
    )
  }

  return declarations
}

/**
 * Reads the light and dark `@plugin "daisyui/theme"` blocks from the app's
 * main.css and keeps the daisyUI settings and tokens. Throws on a token the
 * runtime does not know, so a new token in main.css needs a decision here
 * (mirror it or list it as app-only) before the runtime builds again.
 * `ARTIFACT_THEME_OVERRIDES` then replaces the listed values.
 */
export function extractThemes(mainCss) {
  const themes = new Map()

  for (const body of readThemeBlocks(mainCss)) {
    const declarations = parseDeclarations(body)
    const name = declarations.get('name')?.replace(/^"|"$/g, '')

    if (!name || !THEME_NAMES.includes(name)) {
      continue
    }

    const kept = []
    const overrides = ARTIFACT_THEME_OVERRIDES[name] ?? {}

    for (const [property, value] of declarations) {
      const isKept = THEME_SETTINGS.includes(property)
        || DAISYUI_TOKENS.includes(property)

      if (isKept) {
        kept.push([property, overrides[property] ?? value])

        continue
      }

      if (!APP_ONLY_TOKENS.includes(property)) {
        throw new Error(`Unknown theme token ${property} in main.css theme "${name}". Add it to DAISYUI_TOKENS or APP_ONLY_TOKENS in workers/artifacts-runtime/scripts/theme.mjs.`)
      }
    }

    const missing = DAISYUI_TOKENS.filter((token) => {
      return !declarations.has(token)
    })

    if (missing.length > 0) {
      throw new Error(`Theme "${name}" in main.css lacks ${missing.join(', ')}`)
    }

    themes.set(name, kept)
  }

  for (const name of THEME_NAMES) {
    if (!themes.has(name)) {
      throw new Error(`main.css has no daisyUI theme named "${name}"`)
    }
  }

  return THEME_NAMES.map((name) => {
    return { name, declarations: themes.get(name) }
  })
}

export function renderThemeCss(themes) {
  return themes.map((theme) => {
    const lines = theme.declarations.map(([property, value]) => {
      return `  ${property}: ${value};`
    })

    return [THEME_BLOCK_START, ...lines, '}'].join('\n')
  }).join('\n\n')
}

export function createThemeModule(mainCss) {
  const css = renderThemeCss(extractThemes(mainCss))

  if (/[`\\]|\$\{/.test(css)) {
    throw new Error('The main.css theme contains a character that cannot go into a template literal')
  }

  return [
    '/**',
    ' * Generated by workers/artifacts-runtime/scripts/theme.mjs from',
    ' * app/assets/css/main.css. Do not edit; run `pnpm run artifacts:theme`.',
    ' */',
    `export const BESIDKA_THEME_CSS = \`${css}\``,
    '',
  ].join('\n')
}

export function readTailwindColors() {
  const require = createRequire(import.meta.url)
  const themeCss = readFileSync(require.resolve('tailwindcss/theme.css'), 'utf8')
  const colors = new Map()

  for (const match of themeCss.matchAll(/(--color-[a-z0-9-]+):\s*([^;]+);/g)) {
    colors.set(match[1], match[2].trim())
  }

  return colors
}

function resolveColor(value, tailwindColors) {
  const reference = value.match(/^var\((--color-[a-z0-9-]+)\)$/)

  if (!reference) {
    return value
  }

  const resolved = tailwindColors.get(reference[1])

  if (!resolved) {
    throw new Error(`Tailwind has no colour ${reference[1]}, referenced by the main.css theme`)
  }

  return resolveColor(resolved, tailwindColors)
}

/**
 * The colours the block chrome and the shell need, resolved to the values
 * Tailwind gives the main.css theme tokens, so a Markdown, SVG or Mermaid
 * artifact (no Tailwind, no daisyUI) draws with the chat's stone palette
 * and an HTML artifact redeclares the values it already has. Dark also
 * carries the colours the chat's diagram series switch to.
 */
export function createPalette(mainCss, tailwindColors = readTailwindColors()) {
  const palette = {}

  for (const theme of extractThemes(mainCss)) {
    const declared = new Map(theme.declarations)
    const entries = PALETTE_TOKENS.map((token) => {
      return [token, resolveColor(declared.get(token), tailwindColors)]
    })

    if (theme.name === 'dark') {
      for (const token of DARK_DIAGRAM_SERIES_COLORS) {
        entries.push([token, resolveColor(`var(${token})`, tailwindColors)])
      }
    }

    palette[theme.name] = entries
  }

  return palette
}

export function createPaletteModule(mainCss, tailwindColors) {
  const palette = createPalette(mainCss, tailwindColors)
  const themeBlocks = THEME_NAMES.map((name) => {
    const lines = palette[name].map(([token, value]) => {
      return `    '${token}': '${value}',`
    })

    return [`  ${name}: {`, ...lines, '  },'].join('\n')
  })

  return [
    '/**',
    ' * Generated by workers/artifacts-runtime/scripts/theme.mjs from',
    ' * app/assets/css/main.css and tailwindcss/theme.css. Do not edit; run',
    ' * `pnpm run artifacts:theme`.',
    ' */',
    'import type { Theme } from \'@besidka/artifacts-protocol\'',
    '',
    'export const PALETTE_TOKENS: Record<Theme, Record<string, string>> = {',
    themeBlocks.join('\n'),
    '}',
    '',
  ].join('\n')
}

function main() {
  const mainCss = readFileSync(MAIN_CSS_PATH, 'utf8')

  writeFileSync(THEME_MODULE_PATH, createThemeModule(mainCss))
  writeFileSync(PALETTE_MODULE_PATH, createPaletteModule(mainCss))
  console.log(`Wrote ${path.relative(process.cwd(), THEME_MODULE_PATH)}`)
  console.log(`Wrote ${path.relative(process.cwd(), PALETTE_MODULE_PATH)}`)
}

const isEntryPoint = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isEntryPoint) {
  main()
}
