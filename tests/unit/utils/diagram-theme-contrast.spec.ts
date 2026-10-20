import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  contrastRatio,
  extractBlock,
  oklabDistance,
  parseDeclarations,
  resolveColor,
} from '../../utils/diagram-theme-colors'
import type { CssVariables } from '../../utils/diagram-theme-colors'

type ThemeName = 'light' | 'dark'
type CheckGroup
  = | 'fg-bg'
    | 'fg-surface'
    | 'line-bg'
    | 'accent-bg'
    | 'border-bg'
    | 'border-surface'
    | 'border-subtle'
    | 'surface-alt-bg'
    | 'surface-alt-subtle'
    | 'fg-surface-alt'
    | 'muted-bg'
    | 'series-bg'
    | 'series-surface'
    | 'series-distinct'

interface Check {
  group: CheckGroup
  label: string
  value: number
  threshold: number
}

const THEMES: ThemeName[] = ['light', 'dark']
const SERIES_INDEXES: number[] = [1, 2, 3, 4, 5, 6, 7, 8]
const TEXT_CONTRAST: number = 4.5
const GRAPHIC_CONTRAST: number = 3
const BORDER_BACKGROUND_CONTRAST: number = 3
const BORDER_SURFACE_CONTRAST: number = 2.2
const SURFACE_ALT_BACKGROUND_CONTRAST: number = 1.3
const BORDER_SUBTLE_MARGIN: number = 0.5
const MUTED_CONTRAST: number = 3
const SERIES_BACKGROUND_CONTRAST: number = 1.8
const SERIES_SURFACE_CONTRAST: number = 1.5
const SERIES_MIN_OKLAB_DISTANCE: number = 0.08

const DARK_OVERRIDE_PATTERN: RegExp
  = /\[data-theme=['"]dark['"]\]\s+\.pele-theme\s*\{/

const OLD_PELE_THEME_CSS: string = `
.pele-theme {
  --pele-bg: var(--color-base-100);
  --pele-fg: var(--color-base-content);
  --pele-line: var(--color-base-content);
  --pele-surface: var(--color-base-200);
  --pele-border: var(--color-base-300);
  --pele-surface-alt: var(--color-base-300);
  --pele-muted: var(--color-base-content);
  --pele-accent: var(--color-primary);
  --pele-series-1: var(--color-primary);
  --pele-series-2: var(--color-secondary);
  --pele-series-3: var(--color-accent);
  --pele-series-4: var(--color-info);
  --pele-series-5: var(--color-success);
  --pele-series-6: var(--color-warning);
  --pele-series-7: var(--color-error);
  --pele-series-8: var(--color-neutral);
}
`

function readProjectFile(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8')
}

function readThemeVariables(
  mainCss: string,
  tailwindVariables: CssVariables,
  theme: ThemeName,
): CssVariables {
  const themeBlock = extractBlock(
    mainCss,
    new RegExp(`@plugin "daisyui/theme"\\s*\\{\\s*name: "${theme}"`),
  )

  return { ...tailwindVariables, ...parseDeclarations(themeBlock) }
}

function readPeleMapping(css: string, theme?: ThemeName): CssVariables {
  const baseMapping = parseDeclarations(
    extractBlock(css, /^\.pele-theme\s*\{/m),
  )

  if (theme !== 'dark' || !DARK_OVERRIDE_PATTERN.test(css)) {
    return baseMapping
  }

  return {
    ...baseMapping,
    ...parseDeclarations(extractBlock(css, DARK_OVERRIDE_PATTERN)),
  }
}

function collectChecks(
  peleMapping: CssVariables,
  themeVariables: CssVariables,
): Check[] {
  const color = (name: string) => {
    const value = peleMapping[name]

    if (value === undefined) {
      throw new Error(`Missing ${name} in the .pele-theme mapping`)
    }

    return resolveColor(value, themeVariables)
  }
  const background = color('--pele-bg')
  const surface = color('--pele-surface')
  const border = color('--pele-border')
  const surfaceAlt = color('--pele-surface-alt')
  const lineBackgroundContrast = contrastRatio(color('--pele-line'), background)
  const borderBackgroundContrast = contrastRatio(border, background)
  const checks: Check[] = [
    {
      group: 'fg-bg',
      label: 'fg vs bg',
      value: contrastRatio(color('--pele-fg'), background),
      threshold: TEXT_CONTRAST,
    },
    {
      group: 'fg-surface',
      label: 'fg vs surface',
      value: contrastRatio(color('--pele-fg'), surface),
      threshold: TEXT_CONTRAST,
    },
    {
      group: 'line-bg',
      label: 'line vs bg',
      value: lineBackgroundContrast,
      threshold: GRAPHIC_CONTRAST,
    },
    {
      group: 'accent-bg',
      label: 'accent vs bg',
      value: contrastRatio(color('--pele-accent'), background),
      threshold: GRAPHIC_CONTRAST,
    },
    {
      group: 'border-bg',
      label: 'border vs bg',
      value: borderBackgroundContrast,
      threshold: BORDER_BACKGROUND_CONTRAST,
    },
    {
      group: 'border-surface',
      label: 'border vs surface',
      value: contrastRatio(border, surface),
      threshold: BORDER_SURFACE_CONTRAST,
    },
    {
      group: 'border-subtle',
      label: 'line vs bg minus border vs bg',
      value: lineBackgroundContrast - borderBackgroundContrast,
      threshold: BORDER_SUBTLE_MARGIN,
    },
    {
      group: 'surface-alt-bg',
      label: 'surface-alt vs bg',
      value: contrastRatio(surfaceAlt, background),
      threshold: SURFACE_ALT_BACKGROUND_CONTRAST,
    },
    {
      group: 'surface-alt-subtle',
      label: 'border vs bg minus surface-alt vs bg',
      value: borderBackgroundContrast - contrastRatio(surfaceAlt, background),
      threshold: BORDER_SUBTLE_MARGIN,
    },
    {
      group: 'fg-surface-alt',
      label: 'fg vs surface-alt',
      value: contrastRatio(color('--pele-fg'), surfaceAlt),
      threshold: TEXT_CONTRAST,
    },
    {
      group: 'muted-bg',
      label: 'muted vs bg',
      value: contrastRatio(color('--pele-muted'), background),
      threshold: MUTED_CONTRAST,
    },
  ]

  for (const index of SERIES_INDEXES) {
    const series = color(`--pele-series-${index}`)

    checks.push(
      {
        group: 'series-bg',
        label: `series-${index} vs bg`,
        value: contrastRatio(series, background),
        threshold: SERIES_BACKGROUND_CONTRAST,
      },
      {
        group: 'series-surface',
        label: `series-${index} vs surface`,
        value: contrastRatio(series, surface),
        threshold: SERIES_SURFACE_CONTRAST,
      },
    )

    for (const otherIndex of SERIES_INDEXES.filter(other => other > index)) {
      checks.push({
        group: 'series-distinct',
        label: `series-${index} vs series-${otherIndex}`,
        value: oklabDistance(
          series,
          color(`--pele-series-${otherIndex}`),
        ),
        threshold: SERIES_MIN_OKLAB_DISTANCE,
      })
    }
  }

  return checks
}

function describeFailures(checks: Check[], group: CheckGroup): string[] {
  return checks
    .filter(check => check.group === group && check.value < check.threshold)
    .map((check) => {
      return `${check.label}: ${check.value.toFixed(3)} < ${check.threshold}`
    })
}

describe('diagram theme contrast', () => {
  const mainCss = readProjectFile('app/assets/css/main.css')
  const tailwindVariables = parseDeclarations(
    extractBlock(readProjectFile('node_modules/tailwindcss/theme.css'), /@theme/),
  )
  const themeCss = readProjectFile('app/assets/css/diagram-theme.css')

  for (const theme of THEMES) {
    describe(`${theme} theme`, () => {
      const themeVariables = readThemeVariables(
        mainCss,
        tailwindVariables,
        theme,
      )
      const checks = collectChecks(
        readPeleMapping(themeCss, theme),
        themeVariables,
      )

      it('keeps fg text at WCAG AA (4.5:1) on bg', () => {
        expect(describeFailures(checks, 'fg-bg')).toEqual([])
      })

      it('keeps fg text at WCAG AA (4.5:1) on surface', () => {
        expect(describeFailures(checks, 'fg-surface')).toEqual([])
      })

      it('keeps line at the WCAG graphics minimum (3:1) on bg', () => {
        expect(describeFailures(checks, 'line-bg')).toEqual([])
      })

      it('keeps accent at the WCAG graphics minimum (3:1) on bg', () => {
        expect(describeFailures(checks, 'accent-bg')).toEqual([])
      })

      it('keeps border visible on bg (>= 3:1)', () => {
        expect(describeFailures(checks, 'border-bg')).toEqual([])
      })

      it('keeps border visible on surface (>= 2.2:1)', () => {
        expect(describeFailures(checks, 'border-surface')).toEqual([])
      })

      it('keeps border subtler than line on bg', () => {
        expect(describeFailures(checks, 'border-subtle')).toEqual([])
      })

      it('keeps surface-alt visible on bg (>= 1.3:1)', () => {
        expect(describeFailures(checks, 'surface-alt-bg')).toEqual([])
      })

      it('keeps surface-alt subtler than border on bg', () => {
        expect(describeFailures(checks, 'surface-alt-subtle')).toEqual([])
      })

      it('keeps fg text at WCAG AA (4.5:1) on surface-alt', () => {
        expect(describeFailures(checks, 'fg-surface-alt')).toEqual([])
      })

      it('keeps muted text at the graphics minimum (3:1) on bg', () => {
        expect(describeFailures(checks, 'muted-bg')).toEqual([])
      })

      it('keeps every series color visible on bg (>= 1.8:1)', () => {
        expect(describeFailures(checks, 'series-bg')).toEqual([])
      })

      it('keeps every series color visible on surface (>= 1.5:1)', () => {
        expect(describeFailures(checks, 'series-surface')).toEqual([])
      })

      it(
        'keeps every pair of series colors apart by an OKLab Euclidean '
        + 'distance of at least 0.08',
        () => {
          expect(describeFailures(checks, 'series-distinct')).toEqual([])
        },
      )
    })
  }

  describe('previous primary/secondary/neutral mapping', () => {
    const previousMapping = readPeleMapping(OLD_PELE_THEME_CSS)

    function failedLabels(theme: ThemeName): string[] {
      return collectChecks(
        previousMapping,
        readThemeVariables(mainCss, tailwindVariables, theme),
      )
        .filter(check => check.value < check.threshold)
        .map(check => check.label)
    }

    it('is rejected in the light theme because secondary is white on white', () => {
      const failures = failedLabels('light')

      expect(failures).toContain('series-2 vs bg')
    })

    it('is rejected in the dark theme because primary and neutral equal bg', () => {
      const failures = failedLabels('dark')

      expect(failures).toEqual(
        expect.arrayContaining([
          'series-1 vs bg',
          'series-8 vs bg',
          'series-1 vs series-8',
        ]),
      )
    })
  })
})
