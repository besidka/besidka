import { expect, test } from '@playwright/test'
import {
  createUniqueUser,
  signIn,
  signUpByApi,
} from '../helpers/auth'

test.use({
  storageState: {
    cookies: [],
    origins: [],
  },
})

test.describe('Sign In', () => {
  test('redirects guest to signin for protected routes', async ({ page }) => {
    await page.goto('/chats/new')
    await page.waitForURL('/signin')
    await expect(page.getByRole('button', {
      name: 'Sign in',
      exact: true,
    })).toBeVisible()
  })

  test('redirects to chats page after successful sign in', async ({
    page,
  }) => {
    test.setTimeout(20_000)

    const user = createUniqueUser('auth-ui')

    await signUpByApi(page, user)
    await page.context().clearCookies()
    await signIn(page, user.email, user.password)
    await expect(page).toHaveURL('/chats/new')
  })

  test('returns to the originally requested page after sign in', async ({
    page,
  }) => {
    test.setTimeout(30_000)

    const user = createUniqueUser('auth-next')
    const requestedPath = '/profile/keys?provider=google'

    await signUpByApi(page, user)
    await page.context().clearCookies()
    await page.goto(requestedPath)
    await page.waitForURL(/\/signin\?next=/)

    const signInUrl = new URL(page.url())

    expect(signInUrl.pathname).toBe('/signin')
    expect(signInUrl.searchParams.get('next')).toBe(requestedPath)

    await signIn(page, user.email, user.password, {
      startPath: signInUrl.pathname + signInUrl.search,
      expectedUrl: requestedPath,
    })
    await expect(page).toHaveURL(requestedPath)
  })

  test('ignores an unsafe next value and signs in to the default page', async ({
    page,
  }) => {
    test.setTimeout(30_000)

    const user = createUniqueUser('auth-next-unsafe')

    await signUpByApi(page, user)
    await page.context().clearCookies()
    await signIn(page, user.email, user.password, {
      startPath: '/signin?next=%2F%2Fevil.com',
    })
    await expect(page).toHaveURL('/chats/new')
  })
})
