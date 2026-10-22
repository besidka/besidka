import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(
  resolve(process.cwd(), 'app/assets/css/video-player-theme.css'),
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

describe('video-player-theme.css', () => {
  it('does not crop the 16:9 frame with object-fit: cover', () => {
    expect(stylesheet).not.toMatch(/object-fit\s*:\s*cover/)
  })

  it('fits the video inside the frame with object-fit: contain', () => {
    expect(stylesheet).toMatch(/object-fit\s*:\s*contain/)
  })

  it.each([
    '.landing-player:fullscreen',
    '.landing-player:-webkit-full-screen',
  ])('removes the border radius and paints black for %s', (selector) => {
    expectDeclaration(selector, /border-radius\s*:\s*0\s*;/)
    expectDeclaration(selector, /background\s*:\s*#000\s*;/)
  })

  it.each([
    '.landing-player:fullscreen > video',
    '.landing-player:-webkit-full-screen > video',
  ])('squares the video corners on a black backdrop for %s', (selector) => {
    expectDeclaration(selector, /border-radius\s*:\s*0\s*;/)
    expectDeclaration(selector, /background\s*:\s*#000\s*;/)
  })

  it('lets the fullscreen container fill the screen', () => {
    expectDeclaration('.landing-player:fullscreen', /width\s*:\s*100%\s*;/)
    expectDeclaration('.landing-player:fullscreen', /height\s*:\s*100%\s*;/)
    expectDeclaration(
      '.landing-player:fullscreen',
      /aspect-ratio\s*:\s*auto\s*;/,
    )
  })

  it('drops the obsolete Plyr pseudo-fullscreen bubble hack', () => {
    expect(stylesheet).not.toMatch(/fullscreen-fallback/)
    expect(stylesheet).not.toMatch(/\.bubble:has\(/)
    expect(stylesheet).not.toMatch(/\.plyr/)
  })

  it('shifts the preview card by the clamp custom property', () => {
    expectDeclaration(
      '.landing-player .video-preview__card',
      /translate\s*:\s*var\(--video-preview-shift,\s*0px\)\s+0\s*;/,
    )
  })

  it('paints the radio dot with the accent content color', () => {
    expectDeclaration(
      '.landing-player .video-menu__radio::after',
      /background\s*:\s*var\(--color-accent-content\)\s*;/,
    )
    expect(getDeclarationBlocks('.landing-player .video-menu__radio::after')
      .some((block) => {
        return /background\s*:\s*#fff\s*;/.test(block)
      })).toBe(false)
  })
})
