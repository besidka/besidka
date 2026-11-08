import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'

const PHONE_VIEWPORT = { width: 390, height: 844 }
const DESKTOP_VIEWPORT = { width: 1280, height: 800 }
const KEYBOARD_HEIGHT = 300
const GEOMETRY_TOLERANCE = 2
const CHAT_TEXTAREA = 'textarea[placeholder="Type your message here..."]'

interface FakeVisualViewportWindow {
  __setKeyboardHeight: (height: number) => void
}

interface BoxMetrics {
  bottom: number
  left: number
  right: number
  topLeftRadius: string
  topRightRadius: string
  bottomLeftRadius: string
  bottomRightRadius: string
}

test.describe.configure({ timeout: 45_000 })

async function installFakeVisualViewport(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const events = new EventTarget()
    let keyboardHeight = 0

    const fakeViewport = {
      get height() {
        return window.innerHeight - keyboardHeight
      },
      get width() {
        return window.innerWidth
      },
      offsetTop: 0,
      offsetLeft: 0,
      pageTop: 0,
      pageLeft: 0,
      scale: 1,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    }

    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      get: () => fakeViewport,
    })

    const fakeWindow = window as unknown as FakeVisualViewportWindow

    fakeWindow.__setKeyboardHeight = (height: number) => {
      keyboardHeight = height
      events.dispatchEvent(new Event('resize'))
    }
  })
}

async function setKeyboardHeight(page: Page, height: number): Promise<void> {
  await page.evaluate((keyboardHeight) => {
    const fakeWindow = window as unknown as FakeVisualViewportWindow

    fakeWindow.__setKeyboardHeight(keyboardHeight)
  }, height)
}

async function openSearchModal(page: Page): Promise<Locator> {
  await page.goto('/chats/new')
  await waitForHydration(page)

  const modal = page.getByTestId('search-modal')

  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+k')
    await expect(modal).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })

  return modal
}

async function focusSearchInput(modal: Locator): Promise<void> {
  const input = modal.locator('input').first()

  await input.focus()
  await expect(input).toBeFocused()
}

async function getBoxMetrics(modal: Locator): Promise<BoxMetrics> {
  return modal.locator('.modal-box').first().evaluate((box) => {
    const rect = box.getBoundingClientRect()
    const style = getComputedStyle(box)

    return {
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      topLeftRadius: style.borderTopLeftRadius,
      topRightRadius: style.borderTopRightRadius,
      bottomLeftRadius: style.borderBottomLeftRadius,
      bottomRightRadius: style.borderBottomRightRadius,
    }
  })
}

async function expectKeyboardOpen(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute(
    'data-keyboard-open',
    '',
  )
}

async function expectKeyboardClosed(page: Page): Promise<void> {
  await expect(page.locator('html')).not.toHaveAttribute(
    'data-keyboard-open',
    /.*/,
  )
}

async function expectBoxBottomNear(
  modal: Locator,
  expectedBottom: number,
): Promise<void> {
  await expect.poll(async () => {
    const metrics = await getBoxMetrics(modal)

    return Math.abs(metrics.bottom - expectedBottom)
  }, { timeout: 5_000 }).toBeLessThanOrEqual(GEOMETRY_TOLERANCE)
}

async function getComposerBottom(page: Page): Promise<number> {
  return page.locator(CHAT_TEXTAREA).evaluate((textarea) => {
    const composer = textarea.closest('.fixed') as HTMLElement

    return composer.getBoundingClientRect().bottom
  })
}

test.describe('search modal above the keyboard on a phone', () => {
  test.use({ viewport: PHONE_VIEWPORT })

  test.beforeEach(async ({ page }) => {
    await installFakeVisualViewport(page)
  })

  test('floats above the keyboard with rounded corners, then docks', async ({
    page,
  }) => {
    const modal = await openSearchModal(page)

    await focusSearchInput(modal)
    await setKeyboardHeight(page, KEYBOARD_HEIGHT)

    await expectKeyboardOpen(page)
    await expectBoxBottomNear(modal, PHONE_VIEWPORT.height - KEYBOARD_HEIGHT)

    const openMetrics = await getBoxMetrics(modal)

    expect(openMetrics.bottomLeftRadius).not.toBe('0px')
    expect(openMetrics.bottomRightRadius).not.toBe('0px')
    expect(openMetrics.bottomLeftRadius).toBe(openMetrics.topLeftRadius)
    expect(openMetrics.bottomRightRadius).toBe(openMetrics.topRightRadius)

    await setKeyboardHeight(page, 0)

    await expectKeyboardClosed(page)
    await expectBoxBottomNear(modal, PHONE_VIEWPORT.height)

    const closedMetrics = await getBoxMetrics(modal)

    expect(closedMetrics.bottomLeftRadius).toBe('0px')
    expect(closedMetrics.bottomRightRadius).toBe('0px')
    expect(closedMetrics.topLeftRadius).not.toBe('0px')
    expect(closedMetrics.topRightRadius).not.toBe('0px')
  })

  test('ignores a viewport resize while no text field has focus', async ({
    page,
  }) => {
    const modal = await openSearchModal(page)

    await focusSearchInput(modal)
    await setKeyboardHeight(page, KEYBOARD_HEIGHT)
    await expectKeyboardOpen(page)

    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur()
    })
    await setKeyboardHeight(page, KEYBOARD_HEIGHT)

    await expectKeyboardClosed(page)
    await expectBoxBottomNear(modal, PHONE_VIEWPORT.height)
  })

  test('lifts the chat composer above the keyboard', async ({ page }) => {
    await page.goto('/chats/new')
    await waitForHydration(page)

    const textarea = page.locator(CHAT_TEXTAREA)

    await expect(textarea).toBeVisible()
    await textarea.focus()
    await expect(textarea).toBeFocused()

    const restingBottom = await getComposerBottom(page)

    await setKeyboardHeight(page, KEYBOARD_HEIGHT)

    await expectKeyboardOpen(page)
    await expect.poll(() => getComposerBottom(page), { timeout: 5_000 })
      .toBeLessThanOrEqual(
        PHONE_VIEWPORT.height - KEYBOARD_HEIGHT + GEOMETRY_TOLERANCE,
      )

    await setKeyboardHeight(page, 0)

    await expectKeyboardClosed(page)
    await expect.poll(() => getComposerBottom(page), { timeout: 5_000 })
      .toBeGreaterThan(PHONE_VIEWPORT.height - KEYBOARD_HEIGHT + 50)
    expect(restingBottom).toBeGreaterThan(
      PHONE_VIEWPORT.height - KEYBOARD_HEIGHT + 50,
    )
  })
})

test.describe('search modal on desktop', () => {
  test.use({ viewport: DESKTOP_VIEWPORT })

  test('stays centred with rounded corners and no keyboard padding', async ({
    page,
  }) => {
    const modal = await openSearchModal(page)

    await expectKeyboardClosed(page)

    const metrics = await getBoxMetrics(modal)
    const leftMargin = metrics.left
    const rightMargin = DESKTOP_VIEWPORT.width - metrics.right

    expect(Math.abs(leftMargin - rightMargin))
      .toBeLessThanOrEqual(GEOMETRY_TOLERANCE)
    expect(metrics.topLeftRadius).not.toBe('0px')
    expect(metrics.topRightRadius).not.toBe('0px')
    expect(metrics.bottomLeftRadius).not.toBe('0px')
    expect(metrics.bottomRightRadius).not.toBe('0px')

    const modalPaddingBottom = await modal.evaluate((element) => {
      return getComputedStyle(element).paddingBottom
    })

    expect(modalPaddingBottom).toBe('0px')
  })
})
