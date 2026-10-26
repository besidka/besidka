import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'

interface KeyRow {
  provider: string
  hasKey: boolean
}

const MOBILE_VIEWPORT = { width: 375, height: 812 }
const DESKTOP_VIEWPORT = { width: 1280, height: 900 }
const GOOGLE_GUIDE_VIDEO_URL
  = /\/videos\/key-guide-google(-1080|-360)?\.mp4(\?v=\d+)?$/

function missingRows(...providers: string[]): KeyRow[] {
  return providers.map((provider) => {
    return { provider, hasKey: false }
  })
}

async function mockKeySummary(page: Page, rows: KeyRow[]) {
  await page.route('**/api/v1/profiles/keys', async (route) => {
    await route.fulfill({ json: { keys: rows } })
  })
}

async function openKeysPage(page: Page, query: string = '') {
  await page.goto(`/profile/keys${query}`)
  await waitForHydration(page)
}

function card(page: Page, providerId: string): Locator {
  return page.getByTestId('key-card').filter({
    has: page.getByTestId(`key-card-summary-${providerId}`),
  })
}

function guide(page: Page, providerId: string): Locator {
  return page.getByTestId(`key-guide-${providerId}`)
}

async function navigateInApp(page: Page, path: string) {
  await page.evaluate(async (target) => {
    const root = document.querySelector('#__nuxt') as any

    await root.__vue_app__.config.globalProperties.$router.push(target)
  }, path)
}

async function offsetFromPageTop(page: Page, providerId: string) {
  return page.evaluate((id) => {
    const summary = document
      .querySelector(`[data-testid="key-card-summary-${id}"]`)!
    const container = document.querySelector('.js-page-content')!

    return Math.round(
      summary.getBoundingClientRect().top
      - container.getBoundingClientRect().top,
    )
  }, providerId)
}

test.describe('Profile keys — how to get a key guides', () => {
  test.describe.configure({ timeout: 30_000 })

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
  })

  test('deep link opens the gateways tab, the OpenRouter card and its guide',
    async ({ page }) => {
      await mockKeySummary(page, missingRows('google', 'openrouter'))
      await openKeysPage(page, '?provider=openrouter')

      await expect(page.getByTestId('key-tab-gateways'))
        .toHaveClass(/tab-active/)
      await expect(card(page, 'openrouter')).toHaveAttribute('open', '')
      await expect(guide(page, 'openrouter')).toBeVisible()
      await expect(guide(page, 'openrouter')).toHaveAttribute('open', '')
      await expect(page.getByTestId('key-guide-open-openrouter'))
        .toHaveAttribute('href', 'https://openrouter.ai/settings/keys')
    })

  test('switching tabs shows the guide of the card opened in that tab',
    async ({ page }) => {
      await mockKeySummary(page, missingRows('google', 'openrouter'))
      await openKeysPage(page)

      await expect(async () => {
        await page.getByTestId('key-tab-gateways').click()
        await expect(page.getByTestId('key-panel-gateways'))
          .toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 10_000 })
      await expect(page.getByTestId('key-panel-providers')).toBeHidden()

      await card(page, 'openrouter')
        .getByTestId('key-card-summary-openrouter')
        .click()
      await expect(guide(page, 'openrouter')).toBeVisible()

      await page.getByTestId('key-tab-providers').click()
      await expect(page.getByTestId('key-panel-providers')).toBeVisible()
      await expect(page.getByTestId('key-panel-gateways')).toBeHidden()
    })

  test('the guide is collapsed when the provider key is already saved',
    async ({ page }) => {
      await mockKeySummary(page, [
        { provider: 'google', hasKey: true },
        { provider: 'openrouter', hasKey: false },
      ])
      await openKeysPage(page, '?provider=google')

      await expect(card(page, 'google')).toHaveAttribute('open', '')
      await expect(card(page, 'google').getByTestId('key-status-saved'))
        .toBeVisible()
      await expect(guide(page, 'google')).toBeVisible()
      await expect(guide(page, 'google')).not.toHaveAttribute('open', '')

      await guide(page, 'google').getByTestId('key-guide-summary-google')
        .click()
      await expect(guide(page, 'google')).toHaveAttribute('open', '')
    })

  test('a user with no keys lands on the Google card with its guide open',
    async ({ page }) => {
      await mockKeySummary(page, missingRows('google', 'anthropic', 'openai'))
      await openKeysPage(page)

      await expect(card(page, 'google')).toHaveAttribute('open', '')
      await expect(guide(page, 'google')).toHaveAttribute('open', '')
      await expect(page.getByTestId('key-tab-providers'))
        .toHaveClass(/tab-active/)
    })

  test('reports key_guide_open once for the expanded guide and the server '
    + 'accepts it', async ({ page }) => {
    const eventResponses: Array<{ event: string, target: string, ok: boolean }>
      = []

    page.on('response', async (response) => {
      if (!response.url().endsWith('/api/v1/events')) {
        return
      }

      const body = response.request().postDataJSON()

      eventResponses.push({
        event: body.event,
        target: body.target,
        ok: response.ok(),
      })
    })

    await mockKeySummary(page, missingRows('google', 'openrouter'))
    await openKeysPage(page, '?provider=google')

    await expect(guide(page, 'google')).toHaveAttribute('open', '')
    await expect.poll(() => {
      return eventResponses.filter((entry) => {
        return entry.event === 'key_guide_open'
      })
    }).toEqual([{ event: 'key_guide_open', target: 'google', ok: true }])
  })

  test('an unknown provider id is ignored', async ({ page }) => {
    await mockKeySummary(page, [{ provider: 'google', hasKey: true }])
    await openKeysPage(page, '?provider=not-a-provider')

    await expect(page.getByTestId('key-tab-providers'))
      .toHaveClass(/tab-active/)
    await expect(page.locator('[data-testid="key-card"][open]')).toHaveCount(0)
  })

  test('keeps the key input in the top half of a 375px viewport',
    async ({ page }) => {
      await page.setViewportSize(MOBILE_VIEWPORT)
      await mockKeySummary(page, missingRows('google', 'openrouter'))
      await openKeysPage(page, '?provider=google')

      const keyInput = card(page, 'google').getByTestId('api-key-field')

      await expect(guide(page, 'google')).toHaveAttribute('open', '')
      await expect(async () => {
        const box = await keyInput.boundingBox()

        expect(box).not.toBeNull()
        expect(box!.y + box!.height).toBeLessThanOrEqual(
          MOBILE_VIEWPORT.height / 2,
        )
      }).toPass({ timeout: 5_000 })
    })

  test('raises no hydration warnings on a hard load or in-app navigation',
    async ({ page }) => {
      const hydrationMessages: string[] = []

      page.on('console', (message) => {
        if (/hydrat/i.test(message.text())) {
          hydrationMessages.push(message.text())
        }
      })
      await mockKeySummary(page, missingRows('google', 'openrouter'))

      const visits = [
        { query: '?provider=openrouter', providerId: 'openrouter' },
        { query: '', providerId: 'google' },
        { query: '?provider=google', providerId: 'google' },
      ]

      for (const { query, providerId } of visits) {
        await openKeysPage(page, query)
        await expect(card(page, providerId)).toBeVisible()
        await expect(card(page, providerId)).toHaveAttribute('open', '')
      }

      await page.goto('/chats/new')
      await waitForHydration(page)
      await navigateInApp(page, '/profile/keys')
      await expect(card(page, 'google')).toHaveAttribute('open', '')

      expect(hydrationMessages).toEqual([])
    })

  test('scrolls the deep-linked card to the top on a hard load and after '
    + 'in-app navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 500 })
    await mockKeySummary(page, missingRows('google', 'openrouter'))
    await openKeysPage(page, '?provider=openrouter')

    await expect.poll(() => {
      return offsetFromPageTop(page, 'openrouter')
    }, { timeout: 5_000 }).toBeLessThanOrEqual(24)

    await page.goto('/chats/new')
    await waitForHydration(page)
    await navigateInApp(page, '/profile/keys?provider=openrouter')
    await expect(card(page, 'openrouter')).toHaveAttribute('open', '')

    await expect.poll(() => {
      return offsetFromPageTop(page, 'openrouter')
    }, { timeout: 5_000 }).toBeLessThanOrEqual(24)
  })

  test('falls back to the poster and a note when the video fails to load',
    async ({ page }) => {
      await page.route(GOOGLE_GUIDE_VIDEO_URL, async (route) => {
        await route.fulfill({ status: 404, body: 'Video not found' })
      })
      await mockKeySummary(page, missingRows('google', 'openrouter'))
      await openKeysPage(page, '?provider=google')

      await expect(page.getByTestId('key-guide-video-failed-google'))
        .toHaveText('Video unavailable. Follow the steps below.')
      await expect(
        page.getByTestId('key-guide-video-google').getByTestId('video-player'),
      )
        .toHaveCount(0)
    })

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`renders the guide in the ${colorScheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      await mockKeySummary(page, missingRows('google', 'openrouter'))
      await openKeysPage(page, '?provider=google')

      await expect(page.locator('html'))
        .toHaveAttribute('data-theme', colorScheme)
      await expect(guide(page, 'google')).toHaveAttribute('open', '')
      await expect(page.getByTestId('key-guide-video-google')).toBeVisible()
      await expect(guide(page, 'google').getByText('What you need'))
        .toBeVisible()
      await expect(page.getByTestId('key-guide-open-google')).toBeVisible()
    })
  }
})
