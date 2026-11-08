import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { waitForHydration } from './helpers/auth'

const DEMO_URL = '/chats/test?scenario=long&messages=6&side-panel-demo'
const WIDTH_STORAGE_KEY = 'besidka:side-panel-width'
const DEMO_OPEN = '[data-testid="side-panel-demo-open"]'
const PANEL = '[data-testid="side-panel"]'
const SEPARATOR = '[data-testid="side-panel-separator"]'
const SHEET = '[data-testid="side-panel-sheet"]'
const SWIPE_AREA = '[data-testid="side-panel-swipe-area"]'
const SWIPE_DISTANCE_PX = 200
const SWIPE_STEPS = 10

test.describe.configure({ timeout: 45_000 })

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: 'cookies_consent',
      value: JSON.stringify({
        v: 2,
        granted: ['necessary', 'preferences'],
        id: 'e2e-consent',
        date: new Date().toISOString(),
      }),
      domain: 'localhost',
      path: '/',
    },
  ])
})

async function openDemoChat(page: Page) {
  await page.goto(DEMO_URL)
  await waitForHydration(page)
  await expect(page.locator(DEMO_OPEN)).toBeVisible({ timeout: 15_000 })
}

async function readRootInset(page: Page): Promise<string> {
  return await page.evaluate(() => {
    return document.documentElement.style.getPropertyValue(
      '--side-panel-width',
    )
  })
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('docks beside the chat, resizes from the keyboard, remembers the '
    + 'width after a reload and closes on Escape', async ({ page }) => {
    await openDemoChat(page)
    await page.locator(DEMO_OPEN).click()

    const panel = page.locator(PANEL)
    const separator = page.locator(SEPARATOR)

    await expect(panel).toBeVisible()
    await expect(panel).toHaveAttribute('data-layout', 'docked')
    await expect(separator).toHaveAttribute('aria-valuenow', '480')
    await expect.poll(() => readRootInset(page)).toBe('480px')
    await expect(page.locator('[data-testid="sidebar"]'))
      .toHaveAttribute('data-docked', 'true')

    await separator.focus()
    await page.keyboard.press('ArrowLeft')

    await expect(separator).toHaveAttribute('aria-valuenow', '504')
    await expect.poll(() => readRootInset(page)).toBe('504px')
    await expect.poll(() => {
      return page.evaluate((key) => {
        return window.localStorage.getItem(key)
      }, WIDTH_STORAGE_KEY)
    }).toBe('504')

    await page.reload()
    await waitForHydration(page)
    await expect(page.locator(DEMO_OPEN)).toBeVisible({ timeout: 15_000 })
    await page.locator(DEMO_OPEN).click()

    await expect(panel).toBeVisible()
    await expect(separator).toHaveAttribute('aria-valuenow', '504')

    await page.keyboard.press('Escape')

    await expect(panel).toBeHidden()
    await expect.poll(() => readRootInset(page)).toBe('0px')
    await expect(page.locator('[data-testid="sidebar"]'))
      .not.toHaveAttribute('data-docked', 'true')
  })

  test('expanding to full width traps focus and Escape collapses it before '
    + 'closing', async ({ page }) => {
    await openDemoChat(page)
    await page.locator(DEMO_OPEN).click()

    const panel = page.locator(PANEL)

    await expect(panel).toBeVisible()
    await expect(panel).not.toHaveAttribute('role', 'dialog')

    await page.locator('[data-testid="side-panel-full-width"]').click()

    await expect(panel).toHaveAttribute('role', 'dialog')
    await expect(page.locator(SEPARATOR)).toHaveCount(0)

    await page.keyboard.press('Escape')

    await expect(panel).toBeVisible()
    await expect(panel).not.toHaveAttribute('role', 'dialog')

    await page.keyboard.press('Escape')

    await expect(panel).toBeHidden()
  })
})

test.describe('mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('opens as a bottom sheet and closes with a swipe down on the grab '
    + 'area', async ({ page }) => {
    await openDemoChat(page)
    await page.locator(DEMO_OPEN).click()

    const sheet = page.locator(SHEET)

    await expect(sheet).toBeVisible()
    await expect(sheet).toHaveAttribute('open', '')
    await expect(page.locator(PANEL)).toHaveAttribute('data-layout', 'sheet')
    await expect(page.locator(SEPARATOR)).toHaveCount(0)

    const swipeArea = page.locator(SWIPE_AREA)
    const box = await swipeArea.boundingBox()

    expect(box).not.toBeNull()

    const startX = (box?.x ?? 0) + (box?.width ?? 0) / 2
    const startY = (box?.y ?? 0) + 8

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX, startY + SWIPE_DISTANCE_PX, {
      steps: SWIPE_STEPS,
    })
    await page.mouse.up()

    await expect(sheet).toBeHidden()
  })

  test('the close button also dismisses the sheet', async ({ page }) => {
    await openDemoChat(page)
    await page.locator(DEMO_OPEN).click()

    const sheet = page.locator(SHEET)

    await expect(sheet).toBeVisible()

    await page.locator('[data-testid="side-panel-close"]').click()

    await expect(sheet).toBeHidden()
  })
})
