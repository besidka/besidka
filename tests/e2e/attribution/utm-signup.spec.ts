import { expect, test } from '@playwright/test'
import { readUserAttributionByEmail } from '../helpers/attribution'
import { createUniqueUser, waitForHydration } from '../helpers/auth'

const CONSENT_COOKIE_NAME = 'cookies_consent'
const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365
const CONSENT_COOKIE_EXPIRES_AT = Math.floor(Date.now() / 1000)
  + ONE_YEAR_IN_SECONDS
const EVENTS_ENDPOINT_PATH = '/api/v1/events'
const SIGN_UP_ENDPOINT_PATH = '/api/auth/sign-up/email'

test.use({
  storageState: {
    cookies: [],
    origins: [],
  },
})

test.describe('UTM attribution funnel', () => {
  test('carries first-touch utm from landing to the sign-up record',
    async ({ page }) => {
      test.setTimeout(90_000)

      const user = {
        ...createUniqueUser('utm-signup'),
        name: 'Utm Test User',
      }
      const hydrationWarnings: string[] = []

      page.on('console', (message) => {
        if (message.text().toLowerCase().includes('hydration')) {
          hydrationWarnings.push(message.text())
        }
      })

      await page.context().addCookies([{
        name: CONSENT_COOKIE_NAME,
        value: encodeURIComponent(JSON.stringify({
          v: 1,
          granted: ['necessary'],
          id: 'e2e-funnel',
          date: '2026-01-01T00:00:00.000Z',
        })),
        domain: 'localhost',
        path: '/',
        expires: CONSENT_COOKIE_EXPIRES_AT,
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      }])

      const pageViewRequestPromise = page.waitForRequest((request) => {
        if (request.method() !== 'POST') {
          return false
        }

        if (!request.url().endsWith(EVENTS_ENDPOINT_PATH)) {
          return false
        }

        return request.postDataJSON()?.event === 'landing_page_view'
      })

      await page.goto('/?utm_source=x&utm_campaign=test')
      await waitForHydration(page)

      const pageViewRequest = await pageViewRequestPromise

      expect(pageViewRequest.postDataJSON().utm).toEqual({
        source: 'x',
        campaign: 'test',
      })

      const heroCta = page.getByTestId('landing-hero-primary-cta')

      await expect(heroCta).toHaveAttribute('href', /utm_campaign=test/)
      expect(hydrationWarnings).toEqual([])
      await heroCta.click()

      await expect(page).toHaveURL(/\/signup\?.*utm_campaign=test/)
      await waitForHydration(page)

      const form = page.locator('form')

      await form.getByPlaceholder('John Doe').fill(user.name)
      await form.getByPlaceholder('example@example.com').fill(user.email)
      await form.getByPlaceholder('Enter your password').fill(user.password)
      await form.getByPlaceholder('Confirm your password').fill(
        user.password,
      )
      await form.getByRole('checkbox').check()

      const signUpResponsePromise = page.waitForResponse((response) => {
        return response.url().endsWith(SIGN_UP_ENDPOINT_PATH)
      })

      await form.getByRole('button', {
        name: 'Sign up',
        exact: true,
      }).click()

      const signUpResponse = await signUpResponsePromise

      expect(signUpResponse.ok()).toBe(true)

      await expect(async () => {
        const attribution = readUserAttributionByEmail(user.email)

        expect(attribution).not.toBeNull()
        expect(attribution?.utm_campaign).toBe('test')
        expect(attribution?.utm_source).toBe('x')
        expect(attribution?.utm_medium).toBeNull()
        expect(attribution?.utm_content).toBeNull()
      }).toPass({ timeout: 20_000 })

      const cookies = await page.context().cookies()

      for (const cookie of cookies) {
        expect(cookie.name.toLowerCase()).not.toContain('utm')
        expect(cookie.value.toLowerCase()).not.toContain('utm')
      }

      const storageEntries = await page.evaluate(() => {
        return [localStorage, sessionStorage].flatMap((storage) => {
          return Object.keys(storage).map((key) => {
            return { key, value: storage.getItem(key) ?? '' }
          })
        })
      })

      for (const entry of storageEntries) {
        expect(entry.key.toLowerCase()).not.toContain('utm')
        expect(entry.value.toLowerCase()).not.toContain('utm')
      }
    })
})
