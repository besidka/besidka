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
})
