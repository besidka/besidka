import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SIDE_PANEL_TRANSITION_DURATION,
  SIDE_PANEL_TRANSITION_EASING,
  SIDE_PANEL_TRANSITION_MS,
} from '../../../../app/composables/side-panel'

const stylesheet = readFileSync(
  resolve(process.cwd(), 'app/assets/css/main.css'),
  'utf8',
)

const DURATION_VARIABLE = '--side-panel-transition-duration'
const EASING_VARIABLE = '--side-panel-transition-easing'
const SEAM_FOLLOWER_SELECTORS = [
  '.side-panel-inset',
  '.side-panel-width-follow',
  '.side-panel-seam-right',
  '.side-panel-pill',
]

function getDeclarations(selector: string): string {
  const escapedSelector = selector.replace(/[.[\]]/g, '\\$&')
  const rulePattern = new RegExp(
    `(?:^|\\n)\\s*${escapedSelector}\\s*\\{([^{}]*)\\}`,
  )

  return rulePattern.exec(stylesheet)?.[1] ?? ''
}

describe('side panel seam transition', () => {
  it('declares one duration that matches the scroll-anchor hold', () => {
    const durations = [...stylesheet.matchAll(
      new RegExp(`${DURATION_VARIABLE}:\\s*([^;]+);`, 'g'),
    )].map((match) => {
      return match[1]!.trim()
    })

    expect(durations).toEqual([`${SIDE_PANEL_TRANSITION_MS}ms`, '0ms'])
  })

  it('turns the transition off for reduced motion', () => {
    const reducedMotionBlock = new RegExp(
      '@media \\(prefers-reduced-motion: reduce\\)\\s*\\{\\s*:root\\s*'
      + '\\{([^{}]*)\\}',
    ).exec(stylesheet)?.[1]

    expect(reducedMotionBlock).toContain(`${DURATION_VARIABLE}: 0ms`)
  })

  it.each(SEAM_FOLLOWER_SELECTORS)(
    '%s takes its duration and easing from the shared variables',
    (selector) => {
      const declarations = getDeclarations(selector)

      expect(declarations).toContain(`var(${DURATION_VARIABLE})`)
      expect(declarations).toContain(`var(${EASING_VARIABLE})`)
    },
  )

  it('hands the composer the same variables', () => {
    expect(SIDE_PANEL_TRANSITION_DURATION).toBe(`var(${DURATION_VARIABLE})`)
    expect(SIDE_PANEL_TRANSITION_EASING).toBe(`var(${EASING_VARIABLE})`)
  })

  it('stops every follower from transitioning while the panel is dragged',
    () => {
      const resizingRule = new RegExp(
        '\\.side-panel-resizing\\s*:is\\(([^)]*)\\)\\s*\\{([^{}]*)\\}',
      ).exec(stylesheet)

      expect(resizingRule?.[1]).toContain('.side-panel-inset')
      expect(resizingRule?.[1]).toContain('.side-panel-follow')
      expect(resizingRule?.[1]).toContain('.side-panel-width-follow')
      expect(resizingRule?.[2]).toContain('transition: none !important')
    })
})
