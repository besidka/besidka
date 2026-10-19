import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(
  resolve(process.cwd(), 'app/assets/css/plyr-theme.css'),
  'utf8',
)

function getDeclarationBlocks(selector: string): string[] {
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g
  const blocks: string[] = []

  for (const match of stylesheet.matchAll(rulePattern)) {
    const selectors = match[1]!.split(',').map((part) => {
      return part.trim()
    })

    if (selectors.includes(selector)) {
      blocks.push(match[2]!)
    }
  }

  return blocks
}

function expectDeclaration(selector: string, declaration: RegExp) {
  const blocks = getDeclarationBlocks(selector)

  expect(blocks.length).toBeGreaterThan(0)
  expect(blocks.some((block) => {
    return declaration.test(block)
  })).toBe(true)
}

describe('plyr-theme.css', () => {
  it('does not crop the 16:9 frame with object-fit: cover', () => {
    expect(stylesheet).not.toMatch(/object-fit\s*:\s*cover/)
  })

  it.each([
    '.landing-player .plyr:fullscreen .plyr__video-wrapper',
    '.landing-player .plyr--fullscreen-fallback .plyr__video-wrapper',
  ])('removes border radius in fullscreen for %s', (selector) => {
    expectDeclaration(selector, /border-radius\s*:\s*0\s*;/)
  })

  it('disables backdrop-filter on the bubble in pseudo-fullscreen', () => {
    expectDeclaration(
      '.bubble:has(.landing-player .plyr--fullscreen-fallback)',
      /backdrop-filter\s*:\s*none\s*;/,
    )
  })
})
