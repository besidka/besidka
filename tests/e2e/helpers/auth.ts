import type { Page } from '@playwright/test'

/**
 * Sign in to the application
 */
export async function signIn(
  page: Page,
  email: string = 'test@example.com',
  password: string = 'Password123!',
) {
  await page.goto('/signin')
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL('/chats/new')
}

/**
 * Sign up for a new account
 */
export async function signUp(
  page: Page,
  userData: {
    name: string
    email: string
    password: string
  },
) {
  await page.goto('/signup')
  await page.fill('input[name="name"]', userData.name)
  await page.fill('input[name="email"]', userData.email)
  await page.fill('input[name="password"]', userData.password)
  await page.fill('input[name="confirmPassword"]', userData.password)
  await page.click('button[type="submit"]')
  await page.waitForURL('/chats/new')
}

/**
 * Sign out from the application
 */
export async function signOut(page: Page) {
  await page.click('button[aria-label="Sign out"]')
  await page.waitForURL('/signin')
}

/**
 * Check if user is signed in
 */
export async function isSignedIn(page: Page): Promise<boolean> {
  const currentUrl = page.url()
  return !currentUrl.includes('/signin') && !currentUrl.includes('/signup')
}
