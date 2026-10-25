import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  authenticateUserByApi,
  createUniqueUser,
} from '../helpers/auth'

const CONSENT_COOKIE = 'cookies_consent'
const SHOW_DELAY_BUFFER = 4000
const SHOW_DELAY = 1200
const SHOW_DELAY_MARGIN = 1500
const MULTI_STEP_TIMEOUT = 30_000
const COLOR_MODE_KEY = 'nuxt-color-mode'
const PUSH_DATABASE_NAME = 'besidka-push'
const AUTH_STATE_PATH = '.playwright/auth-user.json'
const PUBLIC_SSR_ROUTES = [
  '/',
  '/privacy-policy',
  '/terms-of-use',
  '/cookie-policy',
  '/signin',
  '/signup',
]

interface ConsentChangedPayload {
  granted: string[]
  denied: string[]
  changed: string[]
}

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

async function readLayoutSize(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element)

    return {
      width: parseFloat(style.width),
      height: parseFloat(style.height),
    }
  })
}

function buildConsentCookieHeader(): string {
  const value = encodeURIComponent(JSON.stringify({
    v: 2,
    granted: ['necessary', 'preferences'],
    id: '550e8400-e29b-41d4-a716-446655440000',
    date: '2026-06-11T12:00:00.000Z',
  }))

  return `${CONSENT_COOKIE}=${value}`
}

async function readColorModeKey(page: Page) {
  return page.evaluate((key) => {
    return localStorage.getItem(key)
  }, COLOR_MODE_KEY)
}

async function readModelKey(page: Page) {
  return page.evaluate(() => {
    return localStorage.getItem('model')
  })
}

async function seedModelKey(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem('model', 'verify-cleanup')
  })
}

async function readIndexedDatabaseNames(page: Page) {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases()

    return databases.map(database => database.name)
  })
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

async function recordConsentChangedEvents(page: Page): Promise<boolean> {
  return page.evaluate(() => {
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
}

async function readConsentChangedEvents(page: Page) {
  return page.evaluate(() => {
    const target = window as unknown as { __consentEvents: unknown[] }

    return target.__consentEvents
  })
}

async function toggleTheme(page: Page) {
  await page
    .locator('[data-testid="theme-switcher"]:visible')
    .first()
    .click()
}

async function openLanding(page: Page) {
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
  await expect(
    page.locator('[data-testid="theme-switcher"]:visible').first(),
  ).toBeVisible()
}

async function dismissPopupWithEscape(page: Page) {
  await expect(page.getByTestId('cookies-popup')).toBeVisible({
    timeout: SHOW_DELAY_BUFFER,
  })
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('cookies-popup')).toBeHidden()
}

test.describe('Cookie consent SSR HTML', () => {
  test('public routes carry no consent state or banner markup for a '
    + 'visitor without a consent cookie', async ({ page }) => {
    await test.step('SSR HTML does not contain the banner markup', async () => {
      const response = await page.request.get('/signin')
      const html = await response.text()

      expect.soft(html).not.toContain('cookies-popup')
      expect.soft(html).not.toContain('cookies-trigger')
    })

    for (const route of PUBLIC_SSR_ROUTES) {
      await test.step(`SSR HTML of ${route} carries no consent state`,
        async () => {
          const response = await page.request.get(route)
          const html = await response.text()

          expect.soft(response.ok()).toBe(true)
          expect.soft(html).not.toContain('cookie-consent:')
        })
    }
  })

  test('public routes carry no consent state for a visitor with a consent '
    + 'cookie', async ({ page }) => {
    for (const route of PUBLIC_SSR_ROUTES) {
      await test.step(`SSR HTML of ${route} carries no consent state for a `
        + 'visitor with a consent cookie', async () => {
        const response = await page.request.get(route, {
          headers: { cookie: buildConsentCookieHeader() },
        })
        const html = await response.text()

        expect.soft(response.ok()).toBe(true)
        expect.soft(html).not.toContain('cookie-consent:')
        expect.soft(html).not.toContain('cookies-popup')
      })
    }
  })
})

test.describe('Cookie consent banner', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/signin')
    await page.waitForLoadState('domcontentloaded')
  })

  test('an undecided visitor gets the translated popup with equal choices, '
    + 'Esc dismisses it without storing anything, and it auto-shows again '
    + 'on the next load', async ({ page }) => {
    test.setTimeout(MULTI_STEP_TIMEOUT)

    const popup = page.getByTestId('cookies-popup')

    await test.step('auto-opens the popup for an undecided visitor',
      async () => {
        await expect(popup).toBeVisible({ timeout: SHOW_DELAY_BUFFER })

        expect(await getConsentCookie(page)).toBeNull()
      })

    await test.step('i18n texts render instead of raw keys', async () => {
      const title = await popup.locator('h2').first().textContent()

      expect(title).not.toContain('cookieConsent')
      expect(title?.trim().length).toBeGreaterThan(3)
    })

    await test.step('first layer offers equal Accept all and Reject all '
      + 'choices', async () => {
      const rejectAll = popup.getByTestId('cookies-reject-all')
      const acceptAll = popup.getByTestId('cookies-allow-all')

      await expect(rejectAll).toBeVisible()
      await expect(acceptAll).toBeVisible()
      await expect(popup.getByTestId('cookies-withdraw')).toHaveCount(0)

      const rejectClass = await rejectAll.getAttribute('class')
      const acceptClass = await acceptAll.getAttribute('class')

      expect(rejectClass).toBe(acceptClass)

      const rejectSize = await readLayoutSize(rejectAll)
      const acceptSize = await readLayoutSize(acceptAll)

      expect(
        Math.abs(rejectSize.width - acceptSize.width),
      ).toBeLessThanOrEqual(0.5)
      expect(
        Math.abs(rejectSize.height - acceptSize.height),
      ).toBeLessThanOrEqual(0.5)
    })

    await test.step('color-mode key is not written for an undecided visitor',
      async () => {
        expect(await readColorModeKey(page)).toBeNull()
      })

    await test.step('dismiss without decision: Esc closes, nothing persisted',
      async () => {
        await page.keyboard.press('Escape')
        await expect(popup).toBeHidden()

        expect(await getConsentCookie(page)).toBeNull()
      })

    await test.step('auto-shows again on next load, still without the '
      + 'color-mode key', async () => {
      await page.reload()
      await expect(popup).toBeVisible({ timeout: SHOW_DELAY_BUFFER })

      expect(await readColorModeKey(page)).toBeNull()
    })
  })

  test('a modal opt-in writes a versioned cookie, fires the changed hook '
    + 'once, and persists across a reload', async ({ page }) => {
    test.setTimeout(MULTI_STEP_TIMEOUT)

    const popup = page.getByTestId('cookies-popup')

    await expect(popup).toBeVisible({ timeout: SHOW_DELAY_BUFFER })

    expect(await recordConsentChangedEvents(page)).toBe(true)

    await commitViaModal(page, 'allow-selected', ['preferences'])
    await expect(popup).toBeHidden()

    await test.step('opt-in commit writes versioned cookie and closes popup',
      async () => {
        const consent = await getConsentCookie(page)

        expect(consent.v).toBe(2)
        expect(consent.granted).toContain('necessary')
        expect(consent.granted).toContain('preferences')
      })

    await test.step('cookie-consent:changed hook fires on commit', async () => {
      const events = await readConsentChangedEvents(page)

      expect(events).toHaveLength(1)

      const payload = events[0] as ConsentChangedPayload

      expect(payload.granted).toContain('necessary')
      expect(payload.granted).toContain('preferences')
      expect(payload.changed).toContain('preferences')
    })

    await test.step('decision persists: no auto-show, popup reflects saved '
      + 'choice', async () => {
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
  })

  test('Customize opens an accessible modal that keeps Tab focus inside, '
    + 'and its Accept all grants every category', async ({ page }) => {
    const popup = page.getByTestId('cookies-popup')
    const modal = page.getByTestId('cookies-modal')

    await expect(popup).toBeVisible({ timeout: SHOW_DELAY_BUFFER })
    await page.getByTestId('cookies-change').click()

    await test.step('modal: a11y attributes', async () => {
      await expect(modal).toBeVisible()
      await expect(popup).toBeHidden()

      const dialog = page.locator('[role="dialog"][aria-modal="true"]')

      await expect(dialog).toBeVisible()
    })

    await test.step('modal keeps Tab focus inside the dialog (focus trap '
      + 'loop)', async () => {
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

    await test.step('modal: entry details and categories', async () => {
      await modal.locator('details > summary').first().click()
      await expect(
        modal.locator('code', { hasText: CONSENT_COOKIE }),
      ).toBeVisible()

      const categorySections = modal.locator('ul > li')
      const count = await categorySections.count()

      expect(count).toBeGreaterThanOrEqual(2)
    })

    await test.step('allow all from modal grants every category', async () => {
      await modal.getByTestId('cookies-allow-all').click()
      await expect(modal).toBeHidden()

      const consent = await getConsentCookie(page)

      expect(consent.granted).toEqual(
        expect.arrayContaining(['necessary', 'preferences']),
      )
    })
  })

  test('Accept all on the first layer grants preferences in one click, then '
    + 'the receipt details and withdraw are offered', async ({ page }) => {
    const popup = page.getByTestId('cookies-popup')

    await expect(popup).toBeVisible({ timeout: SHOW_DELAY_BUFFER })
    await expect(popup.getByTestId('cookies-withdraw')).toHaveCount(0)

    await popup.getByTestId('cookies-allow-all').click()
    await expect(popup).toBeHidden()

    await test.step('Accept all on the first layer grants preferences in one '
      + 'click', async () => {
      const consent = await getConsentCookie(page)

      expect(consent.granted).toEqual(
        expect.arrayContaining(['necessary', 'preferences']),
      )
    })

    await test.step('color-mode key is written once Accept all grants '
      + 'preferences', async () => {
      await expect.poll(() => {
        return readColorModeKey(page)
      }).not.toBeNull()
    })

    await seedModelKey(page)
    await openPopupViaTrigger(page)

    await test.step('details section shows consent date and id after a '
      + 'decision', async () => {
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

    await test.step('withdraw appears after Accept all and removes preference '
      + 'storage entries (cleanup)', async () => {
      const withdraw = popup.getByTestId('cookies-withdraw')

      await expect(withdraw).toBeVisible()
      await withdraw.click()
      await expect(popup).toBeHidden()

      const consent = await getConsentCookie(page)

      expect(consent.granted).toEqual(['necessary'])
      expect(await readModelKey(page)).toBeNull()
    })
  })

  test('Reject all records a necessary-only decision the server accepts, '
    + 'and preference storage stays empty after a reload', async ({ page }) => {
    test.setTimeout(MULTI_STEP_TIMEOUT)

    const popup = page.getByTestId('cookies-popup')

    await expect(popup).toBeVisible({ timeout: SHOW_DELAY_BUFFER })
    await seedModelKey(page)

    const receiptResponse = page.waitForResponse((response) => {
      return response.url().endsWith('/api/v1/consents')
        && response.request().method() === 'POST'
    })

    await popup.getByTestId('cookies-reject-all').click()
    await expect(popup).toBeHidden()

    await test.step('the consent receipt of a real decision is accepted by '
      + 'the server', async () => {
      expect((await receiptResponse).status()).toBe(204)
    })

    await test.step('Reject all records a necessary-only decision and removes '
      + 'preference storage entries', async () => {
      const consent = await getConsentCookie(page)

      expect(consent.granted).toEqual(['necessary'])
      expect(await readModelKey(page)).toBeNull()
    })

    await test.step('reopen shows the current state without withdraw',
      async () => {
        await openPopupViaTrigger(page)

        await expect(popup.getByTestId('cookies-details-toggle')).toBeVisible()
        await expect(
          popup.getByTestId('cookies-state-preferences'),
        ).toHaveAttribute('data-allowed', 'false')
        await expect(popup.getByTestId('cookies-withdraw')).toHaveCount(0)
        await expect(popup.getByTestId('cookies-reject-all')).toHaveCount(0)
      })

    await test.step('color-mode key stays absent after Reject all and a '
      + 'reload', async () => {
      await page.reload()
      await page.waitForTimeout(SHOW_DELAY + SHOW_DELAY_MARGIN)

      expect(await readColorModeKey(page)).toBeNull()
    })
  })

  test('the trigger restores focus after Esc and toggles the popup closed '
    + 'on a second click', async ({ page }) => {
    const popup = page.getByTestId('cookies-popup')
    const trigger = page.getByTestId('cookies-trigger')

    await expect(popup).toBeVisible({ timeout: SHOW_DELAY_BUFFER })
    await page.keyboard.press('Escape')
    await expect(popup).toBeHidden()

    await test.step('focus restores to the trigger after closing with Esc',
      async () => {
        await openPopupViaTrigger(page)
        await page.keyboard.press('Escape')
        await expect(popup).toBeHidden()

        const activeTestId = await page.evaluate(() => {
          return document.activeElement?.getAttribute('data-testid')
        })

        expect(activeTestId).toBe('cookies-trigger')
      })

    await test.step('trigger toggles the popup closed on second click',
      async () => {
        await trigger.click()
        await expect(popup).toBeVisible()
        await expect(trigger).toHaveAttribute('aria-expanded', 'true')

        await trigger.click()
        await expect(popup).toBeHidden()
        await expect(trigger).toHaveAttribute('aria-expanded', 'false')
      })
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

  test('dismissed popup does not reopen after a client-side navigation',
    async ({ page }) => {
      test.setTimeout(MULTI_STEP_TIMEOUT)

      await page.goto('/')

      const popup = page.getByTestId('cookies-popup')

      await expect(popup).toBeVisible({ timeout: SHOW_DELAY_BUFFER })
      await page.keyboard.press('Escape')
      await expect(popup).toBeHidden()

      await page.getByTestId('landing-footer-privacy-link').click()
      await expect(page).toHaveURL(/\/privacy-policy/)

      await page.waitForTimeout(SHOW_DELAY + SHOW_DELAY_MARGIN)

      await expect(popup).toBeHidden()
      await expect(page.getByTestId('cookies-modal')).toBeHidden()
    })

  test('push handoff IndexedDB is never created for an undecided visitor, '
    + 'and one left by an earlier version is removed', async ({ page }) => {
    test.setTimeout(MULTI_STEP_TIMEOUT)

    await openLanding(page)

    await test.step('push handoff IndexedDB is not created for an undecided '
      + 'visitor', async () => {
      await expect(page.getByTestId('cookies-popup')).toBeVisible({
        timeout: SHOW_DELAY_BUFFER,
      })

      expect(await readIndexedDatabaseNames(page))
        .not.toContain(PUSH_DATABASE_NAME)

      await page.reload()
      await page.waitForTimeout(SHOW_DELAY + SHOW_DELAY_MARGIN)

      expect(await readIndexedDatabaseNames(page))
        .not.toContain(PUSH_DATABASE_NAME)
    })

    await test.step('a push handoff IndexedDB left by an earlier version is '
      + 'removed', async () => {
      await page.evaluate((name) => {
        return new Promise<void>((resolve) => {
          const request = indexedDB.open(name, 1)

          request.onsuccess = () => {
            request.result.close()
            resolve()
          }
        })
      }, PUSH_DATABASE_NAME)

      expect(await readIndexedDatabaseNames(page))
        .toContain(PUSH_DATABASE_NAME)

      await page.reload()

      await expect.poll(() => readIndexedDatabaseNames(page))
        .not.toContain(PUSH_DATABASE_NAME)
    })
  })

  test('the remember prompt asks an undecided visitor, Not now holds for '
    + 'the page load, it asks again after a reload, and Remember grants '
    + 'preferences', async ({ page }) => {
    test.setTimeout(MULTI_STEP_TIMEOUT)

    const prompt = page.getByTestId('cookies-remember-prompt')

    await openLanding(page)

    await dismissPopupWithEscape(page)
    await expect(prompt).toBeHidden()

    await test.step('asks to remember preferences when an undecided visitor '
      + 'changes the theme', async () => {
      await toggleTheme(page)

      await expect(prompt).toBeVisible()
      await expect(prompt).toContainText('Remember your preferences')
      expect(await getConsentCookie(page)).toBeNull()
      expect(await readColorModeKey(page)).toBeNull()
    })

    await test.step('Not now hides the prompt for the rest of the page load '
      + 'and records no decision', async () => {
      await page.getByTestId('cookies-remember-dismiss').click()
      await expect(prompt).toBeHidden()

      await toggleTheme(page)
      await page.waitForTimeout(500)

      await expect(prompt).toBeHidden()
      expect(await getConsentCookie(page)).toBeNull()
    })

    await test.step('footer Cookie settings opens the settings dialog',
      async () => {
        const opener = page.getByTestId('footer-cookie-settings')

        await opener.scrollIntoViewIfNeeded()
        await expect(opener).toBeVisible()
        await opener.click()

        await expect(page.getByTestId('cookies-modal')).toBeVisible()
      })

    await test.step('the prompt may ask again after a reload, once the popup '
      + 'is dismissed', async () => {
      await page.reload()
      await dismissPopupWithEscape(page)
      await toggleTheme(page)

      await expect(prompt).toBeVisible()
    })

    await test.step('Remember grants preferences', async () => {
      await page.getByTestId('cookies-remember').click()
      await expect(prompt).toBeHidden()

      const consent = await getConsentCookie(page)

      expect(consent.granted).toEqual(
        expect.arrayContaining(['necessary', 'preferences']),
      )
      expect(consent.granted).not.toContain('analytics')
      expect(await readColorModeKey(page)).not.toBeNull()
    })
  })

  test('a visitor who chose Reject all is never asked to remember',
    async ({ page }) => {
      const popup = page.getByTestId('cookies-popup')
      const prompt = page.getByTestId('cookies-remember-prompt')

      await openLanding(page)
      await expect(popup).toBeVisible({ timeout: SHOW_DELAY_BUFFER })
      await popup.getByTestId('cookies-reject-all').click()
      await expect(popup).toBeHidden()

      await toggleTheme(page)
      await page.waitForTimeout(500)

      await expect(prompt).toBeHidden()
      expect((await getConsentCookie(page)).granted).toEqual(['necessary'])

      await page.reload()
      await page.waitForLoadState('domcontentloaded')
      await toggleTheme(page)
      await page.waitForTimeout(500)

      await expect(prompt).toBeHidden()
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
        const modal = page.getByTestId('cookies-modal')

        await expect(modal).toBeVisible({
          timeout: SHOW_DELAY_BUFFER,
        })

        await expect(page.getByTestId('cookies-popup')).toHaveCount(0)
        await expect(page.getByTestId('cookies-trigger')).toHaveCount(0)
        await expect(modal.getByTestId('cookies-first-layer')).toBeVisible()
        await expect(
          modal.getByTestId('cookies-toggle-preferences'),
        ).toHaveCount(0)

        await modal.getByTestId('cookies-change').click()

        await expect(
          modal.getByTestId('cookies-toggle-preferences'),
        ).toBeVisible()
        await expect(modal.getByTestId('cookies-first-layer')).toHaveCount(0)
      })
  })
})
