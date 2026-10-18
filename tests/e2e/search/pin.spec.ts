import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'

const VIEWPORT = { width: 1280, height: 800 }
const GEOMETRY_TOLERANCE = 1
const LONG_TITLE_REPEAT = 8

test.use({ viewport: VIEWPORT })
test.describe.configure({ timeout: 45_000 })

interface SeededChat {
  slug: string
  title: string
}

function createRunToken(): string {
  return `pin${Date.now().toString(36)}${Math.round(Math.random() * 1000)}`
}

async function seedChat(page: Page, title: string): Promise<SeededChat> {
  const createResponse = await page.request.put('/api/v1/chats/new', {
    data: {
      parts: [{ type: 'text', text: title }],
      tools: [],
    },
  })

  expect(createResponse.ok()).toBe(true)

  const { slug } = await createResponse.json()
  const renameResponse = await page.request.patch(
    `/api/v1/chats/${slug}/rename`,
    { data: { title } },
  )

  expect(renameResponse.ok()).toBe(true)

  return { slug, title }
}

async function seedChats(
  page: Page,
  titles: string[],
): Promise<SeededChat[]> {
  const chats: SeededChat[] = []

  for (const title of titles) {
    chats.push(await seedChat(page, title))
  }

  return chats
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

function getSearchInput(modal: Locator): Locator {
  return modal.locator('input').first()
}

function getRows(modal: Locator): Locator {
  return modal.getByTestId('search-result-row')
}

function getPinToggle(row: Locator): Locator {
  return row.getByTestId('search-result-pin-toggle')
}

async function searchFor(modal: Locator, query: string): Promise<void> {
  await getSearchInput(modal).fill(query)
}

async function clickPinToggle(row: Locator): Promise<void> {
  await row.hover()
  await getPinToggle(row).click()
}

async function expectTooltipShown(wrapper: Locator): Promise<void> {
  await expect.poll(async () => {
    return wrapper.evaluate((element) => {
      return window.getComputedStyle(element, '::before').opacity
    })
  }).toBe('1')
}

async function getBox(locator: Locator) {
  const box = await locator.boundingBox()

  if (!box) {
    throw new Error('Element has no bounding box')
  }

  return box
}

test.describe('quick search pin toggle', () => {
  test('pins and unpins a recent chat without navigating', async ({
    page,
  }) => {
    const token = createRunToken()

    await seedChats(page, [
      `${token} recent one`,
      `${token} recent two`,
      `${token} recent three`,
    ])

    const modal = await openSearchModal(page)
    const rows = getRows(modal)

    await expect(rows).toHaveCount(3)

    const urlBeforeClick = page.url()
    const firstRow = rows.first()
    const toggle = getPinToggle(firstRow)

    await expect(toggle).toHaveAttribute('aria-label', 'Pin')
    await expect(firstRow.getByTestId('chat-pinned-badge')).toHaveCount(0)

    await clickPinToggle(firstRow)

    await expect(toggle).toHaveAttribute('aria-label', 'Unpin')
    await expect(firstRow.getByTestId('chat-pinned-badge')).toBeVisible()
    expect(page.url()).toBe(urlBeforeClick)
    await expect(modal).toBeVisible()

    await clickPinToggle(firstRow)

    await expect(toggle).toHaveAttribute('aria-label', 'Pin')
    await expect(firstRow.getByTestId('chat-pinned-badge')).toHaveCount(0)
    expect(page.url()).toBe(urlBeforeClick)
    await expect(modal).toBeVisible()
  })

  test('keeps the highlighted row when pinning a filtered result', async ({
    page,
  }) => {
    const token = createRunToken()

    await seedChats(page, [
      `${token} filtered one`,
      `${token} filtered two`,
      `${token} filtered three`,
    ])

    const modal = await openSearchModal(page)
    const rows = getRows(modal)

    await searchFor(modal, token)
    await expect(rows).toHaveCount(3)

    const urlBeforeClick = page.url()
    const targetRow = rows.nth(1)
    const toggle = getPinToggle(targetRow)

    await expect(toggle).toHaveAttribute('aria-label', 'Pin')

    await clickPinToggle(targetRow)

    await expect(toggle).toHaveAttribute('aria-label', 'Unpin')
    await expect(targetRow).toHaveAttribute('aria-selected', 'true')
    await expect(rows.first()).toHaveAttribute('aria-selected', 'false')
    expect(page.url()).toBe(urlBeforeClick)
    await expect(modal).toBeVisible()

    await clickPinToggle(targetRow)

    await expect(toggle).toHaveAttribute('aria-label', 'Pin')
    await expect(targetRow).toHaveAttribute('aria-selected', 'true')
  })

  test('fits within the modal without horizontal overflow', async ({
    page,
  }) => {
    const token = createRunToken()
    const longTitle = `${token} ${'very long chat title '.repeat(
      LONG_TITLE_REPEAT,
    )}`.trim()

    await seedChats(page, [
      `${token} layout one`,
      `${token} layout two`,
      longTitle,
    ])

    const modal = await openSearchModal(page)
    const rows = getRows(modal)
    const list = modal.getByTestId('search-modal-results')
    const modalBox = modal.locator('.modal-box')

    await expect(rows).toHaveCount(3)

    const recentOverflow = await list.evaluate((element) => {
      return {
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }
    })

    expect(recentOverflow.scrollWidth)
      .toBeLessThanOrEqual(recentOverflow.clientWidth)

    const longRow = rows.first()
    const longRowToggle = getPinToggle(longRow)
    const tooltipWrapper = longRowToggle.locator('xpath=..')

    await longRow.hover()
    await longRowToggle.hover()
    await expect(tooltipWrapper).toHaveAttribute('data-tip', 'Pin')
    await expectTooltipShown(tooltipWrapper)

    const listBox = await getBox(list)
    const modalBoxRect = await getBox(modalBox)
    const rowBox = await getBox(longRow)
    const wrapperBox = await getBox(tooltipWrapper)

    expect(rowBox.x + GEOMETRY_TOLERANCE).toBeGreaterThanOrEqual(listBox.x)
    expect(rowBox.x + rowBox.width)
      .toBeLessThanOrEqual(listBox.x + listBox.width + GEOMETRY_TOLERANCE)
    expect(wrapperBox.x + GEOMETRY_TOLERANCE)
      .toBeGreaterThanOrEqual(modalBoxRect.x)
    expect(wrapperBox.x + wrapperBox.width)
      .toBeLessThanOrEqual(
        modalBoxRect.x + modalBoxRect.width + GEOMETRY_TOLERANCE,
      )

    const titleMetrics = await longRow.locator('span.truncate').first()
      .evaluate((element) => {
        return {
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          right: element.getBoundingClientRect().right,
        }
      })

    expect(titleMetrics.scrollWidth).toBeGreaterThan(titleMetrics.clientWidth)
    expect(titleMetrics.right)
      .toBeLessThanOrEqual(wrapperBox.x + GEOMETRY_TOLERANCE)

    await page.screenshot({ path: 'test-results/search-pin-recent-hover.png' })

    await searchFor(modal, token)
    await expect(rows).toHaveCount(3)

    const filteredOverflow = await list.evaluate((element) => {
      return {
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }
    })

    expect(filteredOverflow.scrollWidth)
      .toBeLessThanOrEqual(filteredOverflow.clientWidth)

    const filteredRow = rows.nth(1)
    const filteredToggle = getPinToggle(filteredRow)

    await filteredRow.hover()
    await filteredToggle.hover()

    const filteredWrapper = filteredToggle.locator('xpath=..')

    await expectTooltipShown(filteredWrapper)

    const filteredWrapperBox = await getBox(filteredWrapper)
    const filteredRowBox = await getBox(filteredRow)
    const filteredListBox = await getBox(list)

    expect(filteredWrapperBox.x + filteredWrapperBox.width)
      .toBeLessThanOrEqual(
        modalBoxRect.x + modalBoxRect.width + GEOMETRY_TOLERANCE,
      )
    expect(filteredRowBox.x + filteredRowBox.width)
      .toBeLessThanOrEqual(
        filteredListBox.x + filteredListBox.width + GEOMETRY_TOLERANCE,
      )

    await page.screenshot({ path: 'test-results/search-pin-filtered.png' })
  })

  test('keeps focus in the search input after pinning with the mouse', async ({
    page,
  }) => {
    const token = createRunToken()
    const seededChats = await seedChats(page, [
      `${token} keyboard one`,
      `${token} keyboard two`,
      `${token} keyboard three`,
    ])
    const newestFirstChats = [...seededChats].reverse()

    const modal = await openSearchModal(page)
    const rows = getRows(modal)
    const input = getSearchInput(modal)

    await expect(rows).toHaveCount(3)
    await expect(input).toBeFocused()

    await clickPinToggle(rows.first())

    await expect(getPinToggle(rows.first()))
      .toHaveAttribute('aria-label', 'Unpin')
    await expect(input).toBeFocused()

    await page.mouse.move(0, 0)
    await page.keyboard.press('ArrowDown')

    await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(
      new RegExp(`/chats/${newestFirstChats[1]!.slug}$`),
    )
  })
})
