import { test, expect, type Page } from '@playwright/test'
import {
  authenticateUserByApi,
  createUniqueUser,
} from '../helpers/auth'

const CONSENT_COOKIE = 'cookies_consent'
const SHOW_DELAY_BUFFER = 4000
const AUTH_STATE_PATH = '.playwright/auth-user.json'

test.use({
  storageState: {
    cookies: [],
    origins: [],
  },
})

async function getConsentCookie(page: Page) {
  const cookies = await page.context().cookies()
  const consent = cookies.find((cookie) => {
    return cookie.name === CONSENT_COOKIE
  })

  if (!consent) {
    return null
  }

  return JSON.parse(decodeURIComponent(consent.value))
}

async function openPopupViaTrigger(page: Page) {
  await page.getByTestId('cookies-trigger').click()
  await expect(page.getByTestId('cookies-popup')).toBeVisible()
}

async function commitViaModal(
  page: Page,
  action: 'allow-all' | 'allow-selected',
  toggleIds?: string[],
) {
  await page.getByTestId('cookies-change').click()
  const modal = page.getByTestId('cookies-modal')

  await expect(modal).toBeVisible()

  if (toggleIds) {
    for (const id of toggleIds) {
      await modal.getByTestId(`cookies-toggle-${id}`).check()
    }
  }

  if (action === 'allow-all') {
    await modal.getByTestId('cookies-allow-all').click()
  } else {
    await modal.getByTestId('cookies-allow-selected').click()
  }

  await expect(modal).toBeHidden()
}

test.describe('Cookie consent banner', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/signin')
    await page.waitForLoadState('domcontentloaded')
  })

  test('SSR HTML does not contain the banner markup', async ({ page }) => {
    const response = await page.request.get('/signin')
    const html = await response.text()

    expect(html).not.toContain('cookies-popup')
    expect(html).not.toContain('cookies-trigger')
  })

  test('auto-opens the popup for an undecided visitor', async ({ page }) => {
    await expect(page.getByTestId('cookies-popup')).toBeVisible({
      timeout: SHOW_DELAY_BUFFER,
    })

    expect(await getConsentCookie(page)).toBeNull()
  })

  test('dismiss without decision: Esc closes, nothing persisted, '
    + 'auto-shows again on next load', async ({ page }) => {
    const popup = page.getByTestId('cookies-popup')

    await expect(popup).toBeVisible({ timeout: SHOW_DELAY_BUFFER })
    await page.keyboard.press('Escape')
    await expect(popup).toBeHidden()

    expect(await getConsentCookie(page)).toBeNull()

    await page.reload()
    await expect(popup).toBeVisible({ timeout: SHOW_DELAY_BUFFER })
  })

  test('opt-in commit writes versioned cookie and closes popup',
    async ({ page }) => {
      const popup = page.getByTestId('cookies-popup')

      await expect(popup).toBeVisible({ timeout: SHOW_DELAY_BUFFER })

      await commitViaModal(page, 'allow-selected', ['preferences'])
      await expect(popup).toBeHidden()

      const consent = await getConsentCookie(page)

      expect(consent.v).toBe(1)
      expect(consent.granted).toContain('necessary')
      expect(consent.granted).toContain('preferences')
    })

  test('decision persists: no auto-show, popup reflects saved choice',
    async ({ page }) => {
      const popup = page.getByTestId('cookies-popup')

      await expect(popup).toBeVisible({ timeout: SHOW_DELAY_BUFFER })

      await commitViaModal(page, 'allow-selected', ['preferences'])
      await expect(popup).toBeHidden()

      await page.reload()
      await page.waitForTimeout(3000)
      await expect(popup).toBeHidden()

      await openPopupViaTrigger(page)

      await expect(
        page.getByTestId('cookies-state-preferences'),
      ).toHaveAttribute('data-allowed', 'true')

      await expect(
        page.getByTestId('cookies-details-toggle'),
      ).toBeVisible()
    })

  test('i18n texts render instead of raw keys', async ({ page }) => {
    const popup = page.getByTestId('cookies-popup')

    await expect(popup).toBeVisible({ timeout: SHOW_DELAY_BUFFER })

    const title = await popup.locator('h2').first().textContent()

    expect(title).not.toContain('cookieConsent')
    expect(title?.trim().length).toBeGreaterThan(3)
  })

  test('modal: a11y attributes, entry details, empty category text',
    async ({ page }) => {
      const popup = page.getByTestId('cookies-popup')

      await expect(popup).toBeVisible({ timeout: SHOW_DELAY_BUFFER })
      await page.getByTestId('cookies-change').click()

      const modal = page.getByTestId('cookies-modal')

      await expect(modal).toBeVisible()
      await expect(popup).toBeHidden()

      const dialog = page.locator('[role="dialog"][aria-modal="true"]')

      await expect(dialog).toBeVisible()

      await modal.locator('details > summary').first().click()
      await expect(
        modal.locator('code', { hasText: CONSENT_COOKIE }),
      ).toBeVisible()

      const categorySections = modal.locator('ul > li')
      const count = await categorySections.count()

      expect(count).toBeGreaterThanOrEqual(2)
    })

  test('details section shows consent date and id after a decision',
    async ({ page }) => {
      const popup = page.getByTestId('cookies-popup')

      await expect(popup).toBeVisible({ timeout: SHOW_DELAY_BUFFER })

      await commitViaModal(page, 'allow-all')

      await openPopupViaTrigger(page)
      await page.getByTestId('cookies-details-toggle').click()

      const consentId = page.getByTestId('cookies-consent-id')
      const consentDate = page.getByTestId('cookies-consent-date')

      await expect(consentId).toBeVisible()
      await expect(consentDate).toBeVisible()

      const idText = await consentId.textContent()
      const dateText = await consentDate.textContent()

      expect(idText?.trim().length).toBeGreaterThan(0)
      expect(idText?.trim()).not.toBe('—')

      expect(dateText?.trim().length).toBeGreaterThan(0)
      expect(dateText?.trim()).not.toBe('—')
    })

  test('modal keeps Tab focus inside the dialog (focus trap loop)',
    async ({ page }) => {
      const popup = page.getByTestId('cookies-popup')

      await expect(popup).toBeVisible({ timeout: SHOW_DELAY_BUFFER })
      await page.getByTestId('cookies-change').click()
      await expect(page.getByTestId('cookies-modal')).toBeVisible()

      for (let step = 0; step < 25; step += 1) {
        await page.keyboard.press('Tab')

        const inDialog = await page.evaluate(() => {
          const active = document.activeElement
          const dialog = document.querySelector(
            '[role="dialog"][aria-modal="true"]',
          )

          return !!dialog && !!active && dialog.contains(active)
        })

        expect(inDialog).toBe(true)
      }
    })

  test('allow all from modal grants every category', async ({ page }) => {
    const popup = page.getByTestId('cookies-popup')

    await expect(popup).toBeVisible({ timeout: SHOW_DELAY_BUFFER })
    await page.getByTestId('cookies-change').click()

    const modal = page.getByTestId('cookies-modal')

    await expect(modal).toBeVisible()
    await modal.getByTestId('cookies-allow-all').click()
    await expect(modal).toBeHidden()

    const consent = await getConsentCookie(page)

    expect(consent.granted).toEqual(
      expect.arrayContaining(['necessary', 'preferences']),
    )
  })

  test('withdraw removes preference storage entries (cleanup)',
    async ({ page }) => {
      const popup = page.getByTestId('cookies-popup')

      await expect(popup).toBeVisible({ timeout: SHOW_DELAY_BUFFER })

      await page.evaluate(() => {
        localStorage.setItem('model', 'verify-cleanup')
      })

      await page.getByTestId('cookies-withdraw').click()
      await expect(popup).toBeHidden()

      const consent = await getConsentCookie(page)

      expect(consent.granted).toEqual(['necessary'])

      const modelValue = await page.evaluate(() => {
        return localStorage.getItem('model')
      })

      expect(modelValue).toBeNull()
    })

  test('cookie-consent:changed hook fires on commit', async ({ page }) => {
    const popup = page.getByTestId('cookies-popup')

    await expect(popup).toBeVisible({ timeout: SHOW_DELAY_BUFFER })

    const hooked = await page.evaluate(() => {
      const root = document.querySelector('#__nuxt') as unknown as {
        __vue_app__?: {
          config?: {
            globalProperties?: {
              $nuxt?: {
                hook: (name: string, cb: (payload: unknown) => void) => void
              }
            }
          }
        }
      }
      const nuxtApp = root?.__vue_app__?.config?.globalProperties?.$nuxt

      if (!nuxtApp) {
        return false
      }

      const target = window as unknown as { __consentEvents: unknown[] }

      target.__consentEvents = []
      nuxtApp.hook('cookie-consent:changed', (payload) => {
        target.__consentEvents.push(payload)
      })

      return true
    })

    expect(hooked).toBe(true)

    await page.getByTestId('cookies-change').click()

    const modal = page.getByTestId('cookies-modal')

    await expect(modal).toBeVisible()
    await modal.getByTestId('cookies-toggle-preferences').check()
    await modal.getByTestId('cookies-allow-selected').click()
    await expect(modal).toBeHidden()

    const events = await page.evaluate(() => {
      const target = window as unknown as { __consentEvents: unknown[] }

      return target.__consentEvents
    })

    expect(events).toHaveLength(1)

    const payload = events[0] as {
      granted: string[]
      denied: string[]
      changed: string[]
    }

    expect(payload.granted).toContain('necessary')
    expect(payload.granted).toContain('preferences')
    expect(payload.changed).toContain('preferences')
  })

  test('a consent cookie from an older revision triggers re-consent',
    async ({ page }) => {
      await page.context().addCookies([{
        name: CONSENT_COOKIE,
        value: encodeURIComponent(JSON.stringify({
          v: 0,
          granted: ['necessary'],
        })),
        url: `http://localhost:${process.env.E2E_PORT || '3000'}`,
      }])

      await page.reload()

      await expect(page.getByTestId('cookies-popup')).toBeVisible({
        timeout: SHOW_DELAY_BUFFER,
      })
    })

  test('focus restores to the trigger after closing with Esc',
    async ({ page }) => {
      const popup = page.getByTestId('cookies-popup')

      await expect(popup).toBeVisible({ timeout: SHOW_DELAY_BUFFER })
      await page.keyboard.press('Escape')
      await expect(popup).toBeHidden()

      await openPopupViaTrigger(page)
      await page.keyboard.press('Escape')
      await expect(popup).toBeHidden()

      const activeTestId = await page.evaluate(() => {
        return document.activeElement?.getAttribute('data-testid')
      })

      expect(activeTestId).toBe('cookies-trigger')
    })

  test('trigger toggles the popup closed on second click', async ({ page }) => {
    const popup = page.getByTestId('cookies-popup')
    const trigger = page.getByTestId('cookies-trigger')

    await expect(popup).toBeVisible({ timeout: SHOW_DELAY_BUFFER })
    await page.keyboard.press('Escape')
    await expect(popup).toBeHidden()

    await trigger.click()
    await expect(popup).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await trigger.click()
    await expect(popup).toBeHidden()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
})

test.describe('Cookie consent banner (chat layout)', () => {
  test.describe('decided user', () => {
    test.use({ storageState: AUTH_STATE_PATH })

    test.beforeEach(async ({ page }) => {
      await page.goto('/chats/new')
      await page.waitForLoadState('domcontentloaded')
    })

    test('hides the floating trigger and opens the modal from the '
      + 'sidebar menu', async ({ page }) => {
      await expect(page.getByTestId('cookies-trigger')).toHaveCount(0)
      await expect(page.getByTestId('cookies-popup')).toHaveCount(0)

      // The desktop sidebar hides behind a hover-reveal clip-path at rest
      // (only its middle icon peeks), so the "More Features" trigger isn't
      // hit-testable until the pill is actually revealed. Real-hover the
      // container first so Chromium applies :hover and runs the reveal
      // transition, then hover the trigger itself, then force the
      // <details> open (mirrors the proven sidebar-dropdown pattern in
      // files.spec).
      await page.getByTestId('sidebar').hover()

      const moreTrigger = page.getByTestId('sidebar-more-features')

      await moreTrigger.hover()
      await moreTrigger.evaluate((element) => {
        const details = element.closest('details')

        if (details instanceof HTMLDetailsElement) {
          details.open = true
        }
      })

      const menuItem = page.getByTestId('cookies-trigger-menu')

      await expect(menuItem).toBeVisible()
      await menuItem.evaluate((element) => {
        ;(element as HTMLButtonElement).click()
      })

      await expect(page.getByTestId('cookies-modal')).toBeVisible()
    })
  })

  test.describe('undecided user', () => {
    test.use({ storageState: { cookies: [], origins: [] } })

    test.beforeEach(async ({ page }) => {
      await authenticateUserByApi(
        page,
        createUniqueUser('cookies-chat'),
        '/chats/new',
      )
    })

    test('auto-shows the modal instead of the popup on a chat page',
      async ({ page }) => {
        await expect(page.getByTestId('cookies-modal')).toBeVisible({
          timeout: SHOW_DELAY_BUFFER,
        })

        await expect(page.getByTestId('cookies-popup')).toHaveCount(0)
        await expect(page.getByTestId('cookies-trigger')).toHaveCount(0)
      })
  })
})
