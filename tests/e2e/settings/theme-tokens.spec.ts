import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// This spec guards against a regression where a CSS minifier wraps
// DaisyUI's stock (built-in) theme selector in `:is(...)`. Per the CSS
// spec, `:is()` takes the specificity of its MOST specific argument for
// every branch — so DaisyUI's
// `:is(:root:has(input.theme-controller[value=light]:checked),
// [data-theme=light])` inherits the high specificity of the `:has()`
// branch even when an element only matches through the plain
// `[data-theme=light]` branch. That inflated specificity beats this
// project's plain `[data-theme=light]` override (see
// app/assets/css/main.css) regardless of source order, so the light
// theme silently renders DaisyUI's stock palette instead of the custom
// one. The dark theme is unaffected because DaisyUI's stock dark rule
// does not currently pick up the same `:is()` wrapping.
//
// `nuxt dev` cannot reproduce this: Vite serves unminified CSS in dev
// mode, so the cascade never goes through the minifier that introduces
// the bug. This spec therefore asserts against the actual production
// CSS bundle (`pnpm run build` output) rather than the dev server used
// by the rest of the e2e suite.
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url))
const builtNuxtDir = path.join(projectRoot, '.output/public/_nuxt')

function findBuiltEntryCssPath(): string | null {
  if (!existsSync(builtNuxtDir)) {
    return null
  }

  const entryCssFile = readdirSync(builtNuxtDir).find((file) => {
    return /^entry\..*\.css$/.test(file)
  })

  return entryCssFile ? path.join(builtNuxtDir, entryCssFile) : null
}

function ensureBuiltCss(): string {
  // Reuses an existing .output build to avoid rebuilding on every local
  // run. CI always starts from a fresh checkout, so it always builds.
  // Locally, if .output is stale (e.g. main.css changed since the last
  // build), this reads the stale CSS and can false-PASS — run
  // `rm -rf .output` first to force a fresh build against current source.
  const existingCssPath = findBuiltEntryCssPath()

  if (existingCssPath) {
    return readFileSync(existingCssPath, 'utf-8')
  }

  execFileSync('pnpm', ['run', 'build'], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, ROLLDOWN_OPTIONS_VALIDATION: 'loose' },
  })

  const builtCssPath = findBuiltEntryCssPath()

  if (!builtCssPath) {
    throw new Error(
      'Could not locate .output/public/_nuxt/entry.*.css after '
      + '`pnpm run build`. This spec needs the production CSS bundle '
      + 'to check for the DaisyUI stock-theme cascade regression.',
    )
  }

  return readFileSync(builtCssPath, 'utf-8')
}

function fixtureHtml(builtCss: string, theme: 'light' | 'dark'): string {
  return `<!doctype html>
<html data-theme="${theme}">
<head>
<meta charset="utf-8">
<style>${builtCss}</style>
</head>
<body>
<button class="btn btn-primary">Primary</button>
<button class="btn btn-accent">Accent</button>
</body>
</html>`
}

interface ThemeTokens {
  primary: string
  accent: string
}

async function readRootThemeTokens(page: Page): Promise<ThemeTokens> {
  return page.evaluate(() => {
    const rootStyle = getComputedStyle(document.documentElement)

    return {
      primary: rootStyle.getPropertyValue('--color-primary').trim(),
      accent: rootStyle.getPropertyValue('--color-accent').trim(),
    }
  })
}

async function readButtonBackgrounds(page: Page): Promise<ThemeTokens> {
  return page.evaluate(() => {
    const primaryButton = document.querySelector('.btn-primary')
    const accentButton = document.querySelector('.btn-accent')

    if (!primaryButton || !accentButton) {
      throw new Error('Expected .btn-primary and .btn-accent in the DOM')
    }

    return {
      primary: getComputedStyle(primaryButton).backgroundColor,
      accent: getComputedStyle(accentButton).backgroundColor,
    }
  })
}

// This project's custom theme tokens, resolved to the browser's serialized
// computed-style form. Sourced from app/assets/css/main.css:
// light --color-primary/--color-accent -> --color-stone-800/--color-pink-700
// dark  --color-primary/--color-accent -> --color-stone-800/--color-pink-300
const CUSTOM_LIGHT_PRIMARY = 'oklch(26.8% .007 34.298)'
const CUSTOM_LIGHT_ACCENT = 'oklch(52.5% .223 3.958)'
const CUSTOM_DARK_PRIMARY = 'oklch(26.8% .007 34.298)'
const CUSTOM_DARK_ACCENT = 'oklch(82.3% .12 346.018)'

// DaisyUI's stock (built-in) theme values that this project's custom
// "light"/"dark" themes are meant to fully override. If a token below ever
// appears in a computed-style assertion, the override lost the cascade.
const DAISYUI_STOCK_LIGHT_PRIMARY = 'oklch(45% .24 277.023)'
const DAISYUI_STOCK_LIGHT_ACCENT = 'oklch(77% .152 181.912)'
const DAISYUI_STOCK_DARK_PRIMARY = 'oklch(58% .233 277.117)'
const DAISYUI_STOCK_DARK_ACCENT = 'oklch(77% .152 181.912)'

test.describe('Theme token regression guard (built CSS)', () => {
  test.describe.configure({ timeout: 5 * 60_000 })

  let builtCss: string

  test.beforeAll(() => {
    builtCss = ensureBuiltCss()
  })

  test('light theme resolves the custom palette, not DaisyUI stock', async ({ page }) => {
    await page.setContent(fixtureHtml(builtCss, 'light'))

    const tokens = await readRootThemeTokens(page)
    const backgrounds = await readButtonBackgrounds(page)

    expect(tokens.primary).not.toBe(DAISYUI_STOCK_LIGHT_PRIMARY)
    expect(tokens.accent).not.toBe(DAISYUI_STOCK_LIGHT_ACCENT)

    expect(tokens.primary).toBe(CUSTOM_LIGHT_PRIMARY)
    expect(tokens.accent).toBe(CUSTOM_LIGHT_ACCENT)

    expect(backgrounds.primary).toBe('oklch(0.268 0.007 34.298)')
    expect(backgrounds.accent).toBe('oklch(0.525 0.223 3.958)')
  })

  test('dark theme resolves the custom palette, not DaisyUI stock', async ({ page }) => {
    await page.setContent(fixtureHtml(builtCss, 'dark'))

    const tokens = await readRootThemeTokens(page)
    const backgrounds = await readButtonBackgrounds(page)

    expect(tokens.primary).not.toBe(DAISYUI_STOCK_DARK_PRIMARY)
    expect(tokens.accent).not.toBe(DAISYUI_STOCK_DARK_ACCENT)

    expect(tokens.primary).toBe(CUSTOM_DARK_PRIMARY)
    expect(tokens.accent).toBe(CUSTOM_DARK_ACCENT)

    expect(backgrounds.primary).toBe('oklch(0.268 0.007 34.298)')
    expect(backgrounds.accent).toBe('oklch(0.823 0.12 346.018)')
  })
})
