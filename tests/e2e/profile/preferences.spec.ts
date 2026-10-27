import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'

const PROFILE_LAYOUT_MARKER = 'settings-sign-out'
const SETTINGS_ENDPOINT = '**/api/v1/profiles/settings'

async function holdProfileLayoutUntil(
  page: Page,
  settingsResponse: Promise<unknown>,
) {
  const holdState = { isLayoutHeld: false }

  await page.route('**/_nuxt/*.js', async (route) => {
    const response = await route.fetch()
    const body = await response.text()

    if (body.includes(PROFILE_LAYOUT_MARKER)) {
      holdState.isLayoutHeld = true
      await settingsResponse
    }

    await route.fulfill({ response, body })
  })

  return holdState
}

function collectHydrationMessages(page: Page): string[] {
  const messages: string[] = []

  page.on('console', (message) => {
    const text = message.text()

    if (/hydration/i.test(text)) {
      messages.push(text)
    }
  })

  return messages
}

test.describe('profile preferences direct load', () => {
  test('hydrates the reasoning tabs when settings load before the '
    + 'layout', async ({ page }) => {
    const hydrationMessages = collectHydrationMessages(page)
    const settingsResponse = page.waitForResponse(SETTINGS_ENDPOINT)

    const holdState = await holdProfileLayoutUntil(page, settingsResponse)

    await page.goto('/profile/preferences')
    await waitForHydration(page)
    await settingsResponse

    const tabList = page.getByTestId('default-reasoning-level')

    await expect(tabList).toBeVisible()
    await expect(tabList).toHaveClass(/\btabs\b/)
    await expect(tabList).toHaveClass(/\btabs-box\b/)
    await expect(tabList).not.toHaveClass(/\bskeleton\b/)
    await expect(tabList.getByRole('radio')).toHaveCount(4)
    await expect(tabList.locator('label.tab')).toHaveCount(4)
    await expect(page.getByTestId('preferences-reasoning-skeleton'))
      .toHaveCount(0)
    await expect(page.getByTestId('preferences-reasoning-expanded-toggle'))
      .toBeVisible()
    await expect(page.getByTestId('preferences-reasoning-auto-hide-toggle'))
      .toBeVisible()

    const skeletonsWithContent = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.skeleton'))
        .filter((skeleton) => {
          return skeleton.children.length > 0
        })
        .length
    })

    expect(holdState.isLayoutHeld).toBe(true)
    expect(skeletonsWithContent).toBe(0)
    expect(hydrationMessages).toEqual([])

    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })
})
