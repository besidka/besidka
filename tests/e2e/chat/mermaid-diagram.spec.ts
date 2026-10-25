import { readFileSync } from 'node:fs'
import type { Download, Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { TEST_MERMAID_MESSAGE } from '../../../server/utils/chats/test/mermaid-fixture'
import { waitForHydration } from '../helpers/auth'

test.describe.configure({
  timeout: 45_000,
})

type ExportAction
  = | 'copy-source'
    | 'copy-svg'
    | 'copy-markdown'
    | 'copy-drawio'
    | 'download-svg'
    | 'download-png'
    | 'download-drawio'

const DIAGRAM_COUNT = 4
const SEQUENCE_INDEX = 1
const PIE_INDEX = 2
const CYNEFIN_INDEX = 3
const MERMAID_BLOCK_PATTERN = /```mermaid\n([\s\S]*?)\n```/g
const DIAGRAM_SOURCES = [
  ...TEST_MERMAID_MESSAGE.matchAll(MERMAID_BLOCK_PATTERN),
].map(match => match[1]!.trim())
const PIE_SOURCE = DIAGRAM_SOURCES[PIE_INDEX]!
const CYNEFIN_SOURCE = DIAGRAM_SOURCES[CYNEFIN_INDEX]!

function getDiagramBlock(page: Page, index: number): Locator {
  return page
    .locator('.mockup-browser')
    .filter({ has: page.locator('[data-testid="mermaid-diagram"]') })
    .nth(index)
}

function getViewer(page: Page): Locator {
  return page.locator('[data-testid="mermaid-viewer"]')
}

async function openCase(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await waitForHydration(page)

  await expect(
    page.locator('[data-testid="chat-messages-container"]'),
  ).toBeVisible()
}

test.describe('Mermaid diagrams', () => {
  test('renders persisted ```mermaid blocks as svgs and shows the inline '
    + 'copy menu without clipping it', async ({ page }) => {
    await openCase(page, '/chats/test?scenario=mermaid&messages=2')

    await test.step('renders a persisted ```mermaid block as an svg',
      async () => {
        const diagrams = page.locator('[data-testid="mermaid-diagram"]')

        await expect(diagrams.first().locator('svg')).toBeVisible({
          timeout: 15_000,
        })
        await expect(diagrams).toHaveCount(DIAGRAM_COUNT)
        await expect(diagrams.locator('svg')).toHaveCount(DIAGRAM_COUNT)
        await expect(diagrams.first()).toContainText('KV hit?')
        await expect(diagrams.nth(1)).toContainText('Stream tokens')
        await expect(diagrams.nth(2)).toContainText('Tokens by provider')
        await expect(diagrams.nth(CYNEFIN_INDEX))
          .toContainText('Market research')
        await expect(page.locator('[data-testid="mermaid-error"]'))
          .toHaveCount(0)
      })

    await test.step('shows the inline copy menu without clipping it',
      async () => {
        const block = getDiagramBlock(page, 0)
        const trigger = block.locator('[data-testid="mermaid-copy"]')

        await trigger.evaluate((element) => {
          element.scrollIntoView({ block: 'start' })
        })
        await trigger.click()

        const lastItem = block.locator(
          '[data-testid="mermaid-export-copy-drawio"]',
        )

        await expect(lastItem).toBeVisible()

        const box = await lastItem.boundingBox()
        const viewport = page.viewportSize()

        expect(box).not.toBeNull()
        expect(viewport).not.toBeNull()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.y).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width)
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height)

        const isHittable = await lastItem.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          const hit = document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          )

          return !!hit && (hit === element || element.contains(hit))
        })

        expect(isHittable).toBe(true)

        await expectOpenMenuInsideBlock(block)

        const overflow = await page.evaluate(() => {
          const diagramBlock = document
            .querySelector('[data-testid="mermaid-diagram"]')!
            .closest('.mockup-browser')!
          const codeArea = diagramBlock
            .querySelector(':scope > .overflow-x-auto')!
          const blockStyle = getComputedStyle(diagramBlock)

          return {
            blockOverflowX: blockStyle.overflowX,
            blockOverflowY: blockStyle.overflowY,
            codeAreaOverflowX: getComputedStyle(codeArea).overflowX,
            pageScrollsHorizontally: document.documentElement.scrollWidth
              > document.documentElement.clientWidth,
          }
        })

        expect(overflow.blockOverflowX).toBe('clip')
        expect(overflow.blockOverflowY).toBe('visible')
        expect(overflow.codeAreaOverflowX).toBe('auto')
        expect(overflow.pageScrollsHorizontally).toBe(false)
      })
  })

  test('renders the diagram once the streamed fence closes', async ({
    page,
  }) => {
    await openCase(page, '/chats/test?scenario=mermaid&messages=1&regenerate')

    await expect(page.locator('[data-role="assistant"]').last()).toBeVisible({
      timeout: 30_000,
    })
    await expect(
      page.locator('button[data-testid="stop-generation"]').first(),
    ).toBeHidden({ timeout: 30_000 })

    await expect(
      page.locator('[data-testid="mermaid-diagram"] svg').first(),
    ).toBeVisible({ timeout: 15_000 })
  })
})

async function waitForAllDiagrams(page: Page): Promise<void> {
  await openCase(page, '/chats/test?scenario=mermaid&messages=2')

  await expect(
    page.locator('[data-testid="mermaid-diagram"] svg'),
  ).toHaveCount(DIAGRAM_COUNT, { timeout: 15_000 })
}

async function hasEmbeddableFontFaces(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const families = ['nunito', 'atkinson hyperlegible mono']

    function collectRules(rules: CSSRuleList): boolean {
      return Array.from(rules).some((rule) => {
        if (rule instanceof CSSFontFaceRule) {
          const family = rule.style
            .getPropertyValue('font-family')
            .replace(/["']/g, '')
            .trim()
            .toLowerCase()

          return families.includes(family)
        }

        const nestedRules = (rule as CSSGroupingRule).cssRules

        return nestedRules ? collectRules(nestedRules) : false
      })
    }

    return Array.from(document.styleSheets).some((sheet) => {
      try {
        return collectRules(sheet.cssRules)
      } catch {
        return false
      }
    })
  })
}

async function readViewerScale(page: Page): Promise<number> {
  return page
    .locator('[data-testid="mermaid-viewer-target"]')
    .evaluate((element) => {
      const match = /scale\(([\d.]+)\)/.exec(
        (element as HTMLElement).style.transform,
      )

      return match ? Number(match[1]) : 1
    })
}

async function readViewerTransform(page: Page): Promise<string> {
  return page
    .locator('[data-testid="mermaid-viewer-target"]')
    .evaluate(element => (element as HTMLElement).style.transform)
}

async function openViewerFromButton(page: Page, index: number) {
  await getDiagramBlock(page, index)
    .locator('[data-testid="mermaid-fullscreen"]')
    .click()

  await expect(getViewer(page)).toBeVisible()
  await expect(
    getViewer(page).locator('[data-testid="mermaid-viewer-target"] svg'),
  ).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => readViewerTransform(page)).toContain('scale(')
}

async function waitForSettledScale(page: Page): Promise<number> {
  let previousScale = -1

  await expect.poll(async () => {
    const scale = await readViewerScale(page)
    const isSettled = Math.abs(scale - previousScale) < 0.0001

    previousScale = scale

    return isSettled
  }, { intervals: [150] }).toBe(true)

  return readViewerScale(page)
}

test.describe('Mermaid diagram viewer', () => {
  test('opens fullscreen from the toolbar button, the keyboard and the '
    + 'inline diagram, and closes on Escape or the close button', async ({
    page,
    browserName,
  }) => {
    await waitForAllDiagrams(page)

    await test.step('opens fullscreen from the toolbar button and closes on '
      + 'Escape', async () => {
      await openViewerFromButton(page, 0)

      await expect(getViewer(page).locator('h2')).toHaveText('Diagram')

      await page.keyboard.press('Escape')

      await expect(getViewer(page)).toHaveCount(0)

      if (browserName === 'webkit') {
        return
      }

      await expect(
        getDiagramBlock(page, 0).locator('[data-testid="mermaid-fullscreen"]'),
      ).toBeFocused()
    })

    await test.step('closes from the close button', async () => {
      await openViewerFromButton(page, 0)

      await getViewer(page)
        .locator('[data-testid="mermaid-viewer-close"]')
        .click()

      await expect(getViewer(page)).toHaveCount(0)
    })

    await test.step('opens fullscreen from the keyboard on the inline '
      + 'diagram', async () => {
      const openButton = getDiagramBlock(page, 0)
        .locator('[data-testid="mermaid-diagram-open"]')

      await openButton.focus()
      await page.keyboard.press('Enter')

      await expect(getViewer(page)).toBeVisible()
      await expect(
        getViewer(page).locator('[data-testid="mermaid-viewer-target"] svg'),
      ).toBeVisible({ timeout: 15_000 })

      await page.keyboard.press('Escape')

      await expect(getViewer(page)).toHaveCount(0)

      if (browserName === 'webkit') {
        return
      }

      await expect(openButton).toBeFocused()
    })

    await test.step('opens fullscreen when the inline diagram is clicked',
      async () => {
        await getDiagramBlock(page, 1)
          .locator('[data-testid="mermaid-diagram"]')
          .click()

        await expect(getViewer(page)).toBeVisible()
        await expect(
          getViewer(page).locator('[data-testid="mermaid-viewer-target"] svg'),
        ).toBeVisible({ timeout: 15_000 })
        await expect(getViewer(page)).toContainText('Stream tokens')
      })
  })

  test('zooms with the buttons and the mouse wheel and shows a tooltip on '
    + 'a hovered zoom button', async ({ page }) => {
    await waitForAllDiagrams(page)
    await openViewerFromButton(page, 0)

    await test.step('zooms in, zooms out and fits to screen', async () => {
      const fittedScale = await waitForSettledScale(page)

      await getViewer(page).locator('[data-testid="mermaid-zoom-in"]').click()

      await expect
        .poll(() => readViewerScale(page))
        .toBeGreaterThan(fittedScale * 1.1)

      await getViewer(page).locator('[data-testid="mermaid-zoom-out"]').click()

      await expect
        .poll(() => readViewerScale(page))
        .toBeCloseTo(fittedScale, 2)

      await getViewer(page).locator('[data-testid="mermaid-zoom-out"]').click()

      await expect
        .poll(() => readViewerScale(page))
        .toBeLessThan(fittedScale * 0.9)

      await getViewer(page)
        .locator('[data-testid="mermaid-zoom-reset"]')
        .click()

      await expect
        .poll(() => readViewerScale(page))
        .toBeCloseTo(fittedScale, 2)

      await getViewer(page).locator('[data-testid="mermaid-zoom-in"]').click()

      await expect
        .poll(() => readViewerScale(page))
        .toBeGreaterThan(fittedScale * 1.1)

      await getViewer(page)
        .locator('[data-testid="mermaid-zoom-reset"]')
        .click()

      await expect
        .poll(() => readViewerScale(page))
        .toBeCloseTo(fittedScale, 2)
    })

    await test.step('shows a tooltip when hovering a zoom button', async () => {
      await waitForSettledScale(page)

      const zoomIn = getViewer(page).locator('[data-testid="mermaid-zoom-in"]')

      await expect(zoomIn).toHaveAttribute('data-tip', 'Zoom in')
      await expect(
        getViewer(page).locator('[data-testid="mermaid-zoom-out"]'),
      ).toHaveAttribute('data-tip', 'Zoom out')
      await expect(
        getViewer(page).locator('[data-testid="mermaid-zoom-reset"]'),
      ).toHaveAttribute('data-tip', 'Fit to screen')

      await zoomIn.hover()

      await expect
        .poll(() => zoomIn.evaluate((element) => {
          const pseudo = getComputedStyle(element, '::before')

          return {
            content: pseudo.content,
            opacity: pseudo.opacity,
          }
        }))
        .toMatchObject({
          content: expect.stringContaining('Zoom in'),
          opacity: '1',
        })
    })

    await test.step('zooms around the cursor with the mouse wheel',
      async () => {
        const fittedScale = await waitForSettledScale(page)
        const viewportBox = await getViewer(page)
          .locator('[data-testid="mermaid-viewer-viewport"]')
          .boundingBox()

        expect(viewportBox).not.toBeNull()

        await page.mouse.move(
          viewportBox!.x + viewportBox!.width / 2,
          viewportBox!.y + viewportBox!.height / 2,
        )
        await page.mouse.wheel(0, -300)

        await expect
          .poll(() => readViewerScale(page))
          .toBeGreaterThan(fittedScale * 1.05)

        const zoomedScale = await readViewerScale(page)

        await page.mouse.wheel(0, 600)

        await expect
          .poll(() => readViewerScale(page))
          .toBeLessThan(zoomedScale)
      })
  })

  test('zooms with a two finger pinch', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CDP touch events are Chromium-only')

    await waitForAllDiagrams(page)
    await openViewerFromButton(page, 0)

    const fittedScale = await waitForSettledScale(page)
    const viewportBox = await getViewer(page)
      .locator('[data-testid="mermaid-viewer-viewport"]')
      .boundingBox()

    expect(viewportBox).not.toBeNull()

    const centerX = Math.round(viewportBox!.x + viewportBox!.width / 2)
    const centerY = Math.round(viewportBox!.y + viewportBox!.height / 2)
    const client = await page.context().newCDPSession(page)

    function touchPoints(spread: number) {
      const shared = { y: centerY, radiusX: 1, radiusY: 1, force: 1 }

      return [
        { ...shared, x: centerX - spread, id: 1 },
        { ...shared, x: centerX + spread, id: 2 },
      ]
    }

    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: touchPoints(40),
    })

    for (const spread of [60, 80, 100, 120, 140, 160]) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: touchPoints(spread),
      })
    }

    await client.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })

    await expect
      .poll(() => readViewerScale(page))
      .toBeGreaterThan(fittedScale * 1.2)
  })
})

async function expectOpenMenuInsideBlock(block: Locator): Promise<void> {
  const card = block.locator('details[open] .dropdown-content ul.menu')

  await expect(card).toBeVisible()

  const result = await card.evaluate((element) => {
    const blockElement = element.closest('.mockup-browser')!
    const cardRect = element.getBoundingClientRect()
    const blockRect = blockElement.getBoundingClientRect()
    const trigger = element.closest('details')!.querySelector('summary')!
    const triggerRect = trigger.getBoundingClientRect()
    const probeX = cardRect.right - 6
    const probeY = cardRect.top + cardRect.height / 2
    const hit = document.elementFromPoint(probeX, probeY)

    return {
      cardLeft: cardRect.left,
      cardRight: cardRect.right,
      blockLeft: blockRect.left,
      blockRight: blockRect.right,
      triggerRight: triggerRect.right,
      isHit: !!hit && element.contains(hit),
    }
  })

  expect(result.cardRight).toBeLessThanOrEqual(result.blockRight)
  expect(result.cardLeft).toBeGreaterThanOrEqual(result.blockLeft)
  expect(Math.abs(result.cardRight - result.triggerRight))
    .toBeLessThanOrEqual(1)
  expect(result.isHit).toBe(true)
}

async function readDownload(download: Download): Promise<Buffer> {
  const filePath = await download.path()

  return readFileSync(filePath)
}

async function chooseExport(
  scope: Locator,
  action: ExportAction,
): Promise<void> {
  const menuTestId = action.startsWith('copy-')
    ? 'mermaid-copy'
    : 'mermaid-download'

  await scope.locator(`[data-testid="${menuTestId}"]`).click()
  await scope.locator(`[data-testid="mermaid-export-${action}"]`).click()
}

async function downloadFrom(
  page: Page,
  scope: Locator,
  action: ExportAction,
): Promise<Download> {
  const downloadPromise = page.waitForEvent('download')

  await chooseExport(scope, action)

  return downloadPromise
}

test.describe('Mermaid diagram export', () => {
  test('downloads a self-contained svg, a non-blank png and a .drawio file '
    + 'inline and from the viewer header', async ({ page }) => {
    await waitForAllDiagrams(page)

    await test.step('downloads a self-contained svg', async () => {
      const download = await downloadFrom(
        page,
        getDiagramBlock(page, CYNEFIN_INDEX),
        'download-svg',
      )

      expect(download.suggestedFilename()).toBe('diagram.svg')

      const markup = (await readDownload(download)).toString('utf-8')
      const hasFontFaces = await hasEmbeddableFontFaces(page)
      const result = await page.evaluate((svgMarkup) => {
        const document = new DOMParser()
          .parseFromString(svgMarkup, 'image/svg+xml')
        const root = document.documentElement
        const firstChild = root.firstElementChild

        return {
          hasParserError: !!document.querySelector('parsererror'),
          rootName: root.localName,
          width: root.getAttribute('width'),
          height: root.getAttribute('height'),
          firstChildName: firstChild?.localName ?? null,
          backgroundFill: firstChild?.getAttribute('fill') ?? null,
          backgroundWidth: firstChild?.getAttribute('width') ?? null,
          hasFontFace: Array.from(root.querySelectorAll('style'))
            .some((style) => {
              return (style.textContent ?? '').includes('@font-face')
            }),
          hasEmbeddedFontData: Array.from(root.querySelectorAll('style'))
            .some((style) => {
              const css = style.textContent ?? ''

              return css.includes('@font-face') && css.includes('url(data:')
            }),
        }
      }, markup)

      expect(result.hasParserError).toBe(false)
      expect(result.rootName).toBe('svg')
      expect(Number(result.width)).toBeGreaterThan(0)
      expect(Number(result.height)).toBeGreaterThan(0)
      expect(result.firstChildName).toBe('rect')
      expect(result.backgroundFill).toMatch(/^#[0-9a-f]{6}$/i)
      expect(Number(result.backgroundWidth)).toBe(Number(result.width))
      expect(result.hasFontFace).toBe(hasFontFaces)
      expect(result.hasEmbeddedFontData).toBe(hasFontFaces)
      expect(markup).not.toContain('var(')
      expect(markup).toContain('Market research')
    })

    await test.step('downloads a valid, non-blank png', async () => {
      const download = await downloadFrom(
        page,
        getDiagramBlock(page, CYNEFIN_INDEX),
        'download-png',
      )

      expect(download.suggestedFilename()).toBe('diagram.png')

      const png = await readDownload(download)

      expect([...png.subarray(0, 8)]).toEqual([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ])
      expect(png.readUInt32BE(16)).toBeGreaterThan(0)
      expect(png.readUInt32BE(20)).toBeGreaterThan(0)

      const pixels = await page.evaluate(async (base64) => {
        const image = new Image()

        image.src = `data:image/png;base64,${base64}`
        await image.decode()

        const canvas = document.createElement('canvas')

        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight

        const context = canvas.getContext('2d')!

        context.drawImage(image, 0, 0)

        const { data } = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        )
        const colors = new Set<number>()

        for (let offset = 0; offset < data.length; offset += 4) {
          colors.add(
            (data[offset]! << 24)
            | (data[offset + 1]! << 16)
            | (data[offset + 2]! << 8)
            | data[offset + 3]!,
          )
        }

        return {
          distinctColors: colors.size,
          topLeftAlpha: data[3],
          bottomRightAlpha: data[data.length - 1],
        }
      }, png.toString('base64'))

      expect(pixels.distinctColors).toBeGreaterThan(2)
      expect(pixels.topLeftAlpha).toBe(255)
      expect(pixels.bottomRightAlpha).toBe(255)
    })

    await test.step('downloads a .drawio file carrying the mermaid source',
      async () => {
        const download = await downloadFrom(
          page,
          getDiagramBlock(page, CYNEFIN_INDEX),
          'download-drawio',
        )

        expect(download.suggestedFilename()).toBe('diagram.drawio')

        const xml = (await readDownload(download)).toString('utf-8')

        expect(xml).toContain('<mxfile')
        expect(xml).toContain('mermaidData')

        const embedded = await page.evaluate((fileXml) => {
          const document = new DOMParser().parseFromString(fileXml, 'text/xml')
          const element = Array.from(document.querySelectorAll('*'))
            .find((node) => {
              return node.hasAttribute('mermaidData')
            })

          return element
            ? JSON.parse(element.getAttribute('mermaidData')!)
            : null
        }, xml)

        expect(embedded.data).toBe(CYNEFIN_SOURCE)

        const imageStyle = await page.evaluate((fileXml) => {
          const document = new DOMParser().parseFromString(fileXml, 'text/xml')
          const cell = Array.from(document.getElementsByTagName('mxCell'))
            .find((node) => {
              return (node.getAttribute('style') ?? '').includes('shape=image')
            })

          return cell?.getAttribute('style') ?? ''
        }, xml)
        const encodedSvg = /image=data:image\/svg\+xml,([^;]+);/
          .exec(imageStyle)?.[1]

        expect(imageStyle).toContain('shape=image')
        expect(encodedSvg).toBeTruthy()
        expect(Buffer.from(encodedSvg!, 'base64').toString('utf-8'))
          .toContain('<svg')
      })

    await test.step('exports from the viewer header menu', async () => {
      await openViewerFromButton(page, CYNEFIN_INDEX)

      const download = await downloadFrom(
        page,
        getViewer(page),
        'download-svg',
      )

      expect(download.suggestedFilename()).toBe('diagram.svg')
      expect((await readDownload(download)).toString('utf-8'))
        .toContain('Market research')
    })
  })

  test.describe('clipboard', () => {
    test.skip(
      ({ browserName }) => browserName !== 'chromium',
      'Clipboard permissions need Chromium',
    )
    test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

    async function readClipboardText(page: Page): Promise<string> {
      return page.evaluate(() => navigator.clipboard.readText())
    }

    test('copies the svg, the raw source, the markdown fence and draw.io '
      + 'clipboard xml', async ({ page }) => {
      await waitForAllDiagrams(page)

      const cynefinBlock = getDiagramBlock(page, CYNEFIN_INDEX)

      await test.step('copies the svg', async () => {
        await chooseExport(cynefinBlock, 'copy-svg')

        await expect.poll(() => readClipboardText(page)).toContain('<svg')

        const markup = await readClipboardText(page)
        const hasFontFaces = await hasEmbeddableFontFaces(page)

        expect(markup).not.toContain('var(')

        if (hasFontFaces) {
          expect(markup).toContain('@font-face')
          expect(markup).toContain('url(data:')
        } else {
          expect(markup).not.toContain('@font-face')
        }

        expect(markup).toContain('Market research')
        await expect(
          cynefinBlock.locator('[data-testid="mermaid-copy"]'),
        ).toContainText('Copied!')
      })

      await test.step('copies the raw diagram source', async () => {
        await chooseExport(cynefinBlock, 'copy-source')

        await expect
          .poll(() => readClipboardText(page))
          .toBe(CYNEFIN_SOURCE)
      })

      await test.step('copies the markdown fence', async () => {
        const pieBlock = getDiagramBlock(page, PIE_INDEX)

        await expect(
          pieBlock.locator('[data-testid="mermaid-copy"]'),
        ).not.toContainText('Copied!')

        await chooseExport(pieBlock, 'copy-markdown')

        await expect
          .poll(() => readClipboardText(page))
          .toBe(`\`\`\`mermaid\n${PIE_SOURCE}\n\`\`\`\n`)
        await expect(
          pieBlock.locator('[data-testid="mermaid-copy"]'),
        ).toContainText('Copied!')
      })

      await test.step('copies draw.io clipboard xml', async () => {
        const sequenceBlock = getDiagramBlock(page, SEQUENCE_INDEX)

        await expect(
          sequenceBlock.locator('[data-testid="mermaid-copy"]'),
        ).not.toContainText('Copied!')

        await chooseExport(sequenceBlock, 'copy-drawio')

        await expect
          .poll(() => readClipboardText(page))
          .toContain('<mxGraphModel')

        const xml = await readClipboardText(page)

        expect(xml).toContain('mermaidData')
        await expect(
          sequenceBlock.locator('[data-testid="mermaid-copy"]'),
        ).toContainText('Copied!')
      })
    })
  })
})

test.describe('Mermaid diagram editing', () => {
  test('edits the source live, exports the edited diagram, and keeps the '
    + 'last diagram with an error note on invalid syntax', async ({ page }) => {
    await waitForAllDiagrams(page)

    const block = getDiagramBlock(page, 0)
    const diagram = block.locator('[data-testid="mermaid-diagram"]')
    const editor = block.locator('[data-testid="mermaid-editor"]')

    await test.step('edits the source live and exports the edited diagram',
      async () => {
        await block.locator('[data-testid="mermaid-edit"]').click()

        await expect(editor).toBeVisible()
        await expect(
          block.locator('[data-testid="mermaid-edit-reset"]'),
        ).toHaveCount(0)

        const originalSource = await editor.inputValue()

        await editor.fill(
          originalSource.replace('Worker --> K', 'Worker[Edge Worker] --> K'),
        )

        await expect(diagram.locator('svg')).toContainText('Edge Worker')
        await expect(
          block.locator('[data-testid="mermaid-edit-reset"]'),
        ).toBeVisible()

        const download = await downloadFrom(page, block, 'download-svg')

        expect((await readDownload(download)).toString('utf-8'))
          .toContain('Edge Worker')

        await block.locator('[data-testid="mermaid-edit-done"]').click()

        await expect(editor).toHaveCount(0)
        await expect(
          block.locator('[data-testid="mermaid-edited-badge"]'),
        ).toBeVisible()
        await expect(diagram.locator('svg')).toContainText('Edge Worker')

        await block.locator('[data-testid="mermaid-edit"]').click()
        await block.locator('[data-testid="mermaid-edit-reset"]').click()

        await expect(diagram.locator('svg')).not.toContainText('Edge Worker')
        await expect(diagram.locator('svg')).toContainText('Worker')
        await expect(editor).toHaveValue(originalSource)
        await expect(
          block.locator('[data-testid="mermaid-edited-badge"]'),
        ).toHaveCount(0)

        await block.locator('[data-testid="mermaid-edit-done"]').click()

        await expect(editor).toHaveCount(0)
      })

    await test.step('keeps the last diagram and shows an error note on '
      + 'invalid syntax', async () => {
      await block.locator('[data-testid="mermaid-edit"]').click()
      await editor.fill('flowchart LR\n  A[Start --> B\n  B --> C')

      const errorNote = block.locator('[data-testid="mermaid-error"]')

      await expect(errorNote).toBeVisible()
      await expect(errorNote).toContainText('Couldn\'t render diagram')
      await expect(diagram).toHaveClass(/opacity-60/)
      await expect(diagram.locator('svg')).toContainText('KV hit?')
      await expect(editor).toBeVisible()
      await expect(block.locator('[data-testid="mermaid-toggle"]'))
        .toHaveCount(0)
    })
  })
})

test.describe('Mermaid diagram toolbar on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('gives the editor a regular box radius and keeps every toolbar '
    + 'control and menu inside the block in edit mode', async ({ page }) => {
    await waitForAllDiagrams(page)

    const block = getDiagramBlock(page, 0)
    const editor = block.locator('[data-testid="mermaid-editor"]')

    await block.locator('[data-testid="mermaid-edit"]').click()

    await test.step('gives the editor a regular box radius', async () => {
      const radius = await editor.evaluate((element) => {
        return parseFloat(getComputedStyle(element).borderTopLeftRadius)
      })

      expect(radius).toBeLessThanOrEqual(12)
    })

    await test.step('keeps every toolbar control and menu inside the block '
      + 'in edit mode', async () => {
      const originalSource = await editor.inputValue()

      await editor.fill(
        originalSource.replace('Worker --> K', 'Worker[Edge Worker] --> K'),
      )

      await expect(
        block.locator('[data-testid="mermaid-edited-badge"]'),
      ).toBeVisible()

      const controlSelector = [
        'mermaid-edited-badge',
        'mermaid-edit-done',
        'mermaid-edit-reset',
        'mermaid-fullscreen',
        'mermaid-download',
        'mermaid-copy',
      ].map(testId => `[data-testid="${testId}"]`).join(', ')

      const controlCount = await block.locator(controlSelector).count()

      expect(controlCount).toBe(6)

      const bounds = await block.evaluate((element, selector) => {
        const blockRect = element.getBoundingClientRect()

        return Array.from(element.querySelectorAll(selector))
          .map((control) => {
            const rect = control.getBoundingClientRect()

            return {
              testId: control.getAttribute('data-testid'),
              top: rect.top,
              bottom: rect.bottom,
              isInside: rect.left >= blockRect.left
                && rect.right <= blockRect.right,
            }
          })
      }, controlSelector)

      for (const control of bounds) {
        expect(control.isInside, `${control.testId} inside the block`)
          .toBe(true)
      }

      const highestBottom = Math.min(...bounds.map(control => control.bottom))
      const lowestTop = Math.max(...bounds.map(control => control.top))

      expect(lowestTop, 'toolbar stays on a single row')
        .toBeLessThan(highestBottom)

      await block.locator('[data-testid="mermaid-download"]').click()
      await expectOpenMenuInsideBlock(block)

      await block.locator('[data-testid="mermaid-copy"]').click()
      await expectOpenMenuInsideBlock(block)
      await expect(block.locator('details[open]')).toHaveCount(1)
      await expect(block.locator('[data-testid="mermaid-export-copy-svg"]'))
        .toBeVisible()
    })
  })
})
