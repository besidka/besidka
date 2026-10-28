import type { Locator, Page } from '@playwright/test'
import { devices, expect, test } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'

const MIN_TEXT_CONTRAST = 4.5

const runningJob = {
  id: 'job-dark-touch-hover',
  status: 'running',
  startedAt: '2026-10-28T10:00:00.000Z',
  finishedAt: null,
  totalChats: 20,
  processedChats: 7,
  createdEntries: 3,
  updatedEntries: 1,
  skippedChats: 1,
  failedChats: 0,
  inputTokens: 1000,
  outputTokens: 200,
  failureReason: null,
  dropped: {},
  model: null,
  estimate: null,
}

test.use({
  ...devices['iPhone 13'],
  defaultBrowserType: undefined,
  colorScheme: 'dark',
  serviceWorkers: 'block',
})

test.describe.configure({ timeout: 45_000 })

async function mockRunningBackfill(page: Page) {
  await page.route('**/api/v1/memory/backfill', async (route) => {
    await route.fulfill({
      json: { job: runningJob, estimate: null, reason: null },
    })
  })
  await page.route('**/api/v1/memory/backfill/step', async (route) => {
    await route.fulfill({
      json: { job: runningJob, isBusy: true, isRetryPending: false },
    })
  })
}

async function openRunningBackfillSheet(page: Page): Promise<Locator> {
  await page.goto('/profile/memory')
  await waitForHydration(page)
  await page.waitForLoadState('networkidle')

  const modal = page.getByTestId('memory-backfill-modal')

  await expect(async () => {
    const menuItem = page.getByTestId('memory-backfill-menu')

    if (!await menuItem.isVisible()) {
      await page.getByTestId('memory-more-trigger').click()
    }

    await menuItem.click({ timeout: 2_000 })
    await expect(modal).toHaveAttribute('open', '', { timeout: 2_000 })
  }).toPass({ timeout: 20_000 })

  await expect(modal.getByTestId('memory-backfill-running'))
    .toBeVisible({ timeout: 15_000 })

  return modal.getByTestId('memory-backfill-dismiss')
}

async function measureContrast(button: Locator) {
  await button.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map(animation => animation.finished),
    )
  })

  return await button.evaluate((element) => {
    const canvas = document.createElement('canvas')

    canvas.width = 1
    canvas.height = 1

    const context = canvas.getContext('2d', { willReadFrequently: true })!

    function toRgba(color: string): number[] {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = '#000'
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)

      return Array.from(context.getImageData(0, 0, 1, 1).data)
    }

    function luminance(channels: number[]): number {
      const [red, green, blue] = channels.map((channel) => {
        const value = channel / 255

        return value <= 0.03928
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4
      })

      return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!
    }

    const backgroundLayers: string[] = []
    let ancestor: Element | null = element

    while (ancestor) {
      backgroundLayers.unshift(getComputedStyle(ancestor).backgroundColor)
      ancestor = ancestor.parentElement
    }

    context.clearRect(0, 0, 1, 1)
    context.fillStyle = '#000'
    context.fillRect(0, 0, 1, 1)

    for (const layer of backgroundLayers) {
      context.fillStyle = layer
      context.fillRect(0, 0, 1, 1)
    }

    const background = Array.from(context.getImageData(0, 0, 1, 1).data)
    const computedColor = getComputedStyle(element).color
    const foreground = toRgba(computedColor)
    const alpha = foreground[3]! / 255
    const blended = [0, 1, 2].map((index) => {
      return foreground[index]! * alpha + background[index]! * (1 - alpha)
    })
    const foregroundLuminance = luminance(blended)
    const backgroundLuminance = luminance(background)
    const lighter = Math.max(foregroundLuminance, backgroundLuminance)
    const darker = Math.min(foregroundLuminance, backgroundLuminance)

    return {
      ratio: (lighter + 0.05) / (darker + 0.05),
      color: computedColor,
      background: `rgb(${background.slice(0, 3).join(', ')})`,
      isHovered: element.matches(':hover'),
    }
  })
}

test.describe('dark theme on touch devices', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.addCookies([
      {
        name: 'cookies_consent',
        value: JSON.stringify({
          v: 2,
          granted: ['necessary', 'preferences'],
          id: 'e2e-dark-touch-hover',
          date: new Date().toISOString(),
        }),
        domain: 'localhost',
        path: '/',
      },
    ])
    await page.addInitScript(() => {
      window.localStorage.setItem('nuxt-color-mode', 'dark')
    })
    await mockRunningBackfill(page)
  })

  test('neutral ghost button stays readable at rest and with a stuck '
    + ':hover', async ({ page }) => {
    const dismissButton = await openRunningBackfillSheet(page)

    const isTouchDevice = await page.evaluate(() => {
      return matchMedia('(hover: none)').matches
    })
    const theme = await page.evaluate(() => {
      return document.documentElement.dataset.theme
    })

    expect(isTouchDevice).toBe(true)
    expect(theme).toBe('dark')

    await page.mouse.move(0, 0)
    await expect(dismissButton).not.toBeFocused()

    const resting = await measureContrast(dismissButton)

    expect(resting.isHovered).toBe(false)
    expect(
      resting.ratio,
      `rest ${resting.color} on ${resting.background}`,
    ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)

    await dismissButton.hover()

    const hovered = await measureContrast(dismissButton)

    expect(hovered.isHovered).toBe(true)
    expect(
      hovered.ratio,
      `hover ${hovered.color} on ${hovered.background}`,
    ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
  })
})
