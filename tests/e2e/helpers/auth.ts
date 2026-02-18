import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

const DEFAULT_PASSWORD = 'Password123!'
const BODY_SNIPPET_MAX_LENGTH = 400
const SIGN_UP_ENDPOINTS = [
  '/api/auth/sign-up/email',
  '/api/auth/sign-up',
]
const SIGN_IN_ENDPOINTS = [
  '/api/auth/sign-in/email',
  '/api/auth/sign-in',
]

export interface E2EAuthUser {
  name: string
  email: string
  password: string
}

interface AuthRequestResult {
  endpoint: string
  status: number
  statusText: string
  location: string
  contentType: string
  bodySnippet: string
}

function getBodySnippet(body: string): string {
  const normalizedBody = body.trim().replace(/\s+/g, ' ')

  if (!normalizedBody.length) {
    return '[empty]'
  }

  if (normalizedBody.length <= BODY_SNIPPET_MAX_LENGTH) {
    return normalizedBody
  }

  return `${normalizedBody.slice(0, BODY_SNIPPET_MAX_LENGTH)}...`
}

function formatAuthRequestResult(result: AuthRequestResult): string {
  return [
    `endpoint=${result.endpoint}`,
    `status=${result.status} ${result.statusText}`,
    `location=${result.location}`,
    `content-type=${result.contentType}`,
    `body=${result.bodySnippet}`,
  ].join(', ')
}

async function typeInputValue(
  input: Locator,
  value: string,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await input.click()
    await input.press('ControlOrMeta+a')
    await input.press('Backspace')
    await input.type(value)

    try {
      await expect(input).toHaveValue(value, { timeout: 1000 })

      return
    } catch (exception) {
      if (attempt === 2) {
        throw exception
      }
    }
  }
}

export function createUniqueEmail(prefix: string = 'e2e'): string {
  const suffix = `${Date.now()}-${Math.round(Math.random() * 100000)}`

  return `${prefix}-${suffix}@example.com`
}

export function createUniqueUser(prefix: string = 'e2e'): E2EAuthUser {
  return {
    name: 'E2E Test User',
    email: createUniqueEmail(prefix),
    password: DEFAULT_PASSWORD,
  }
}

export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const root = document.querySelector('#__nuxt') as any

    return Boolean(root?.__vue_app__)
  })
}

export async function postAuthRequest(
  page: Page,
  endpoints: string[],
  payload: Record<string, unknown>,
): Promise<AuthRequestResult> {
  const results: AuthRequestResult[] = []

  for (const endpoint of endpoints) {
    const response = await page.request.post(endpoint, {
      data: payload,
      failOnStatusCode: false,
    })
    const headers = response.headers()
    const location = headers.location ?? '[none]'
    const contentType = headers['content-type'] ?? '[none]'
    const body = await response.text()
    const result: AuthRequestResult = {
      endpoint,
      status: response.status(),
      statusText: response.statusText(),
      location,
      contentType,
      bodySnippet: getBodySnippet(body),
    }
    const isRedirectWithLocation = result.status >= 300
      && result.status < 400
      && result.location !== '[none]'

    results.push(result)

    if (response.ok() || isRedirectWithLocation) {
      return result
    }

    if (result.status === 404) {
      continue
    }
  }

  throw new Error([
    'Auth request failed for all candidate endpoints.',
    ...results.map((result, index) => {
      return `Attempt ${index + 1}: ${formatAuthRequestResult(result)}`
    }),
  ].join('\n'))
}

export async function signUpByApi(
  page: Page,
  user: E2EAuthUser,
): Promise<AuthRequestResult> {
  return postAuthRequest(page, SIGN_UP_ENDPOINTS, {
    name: user.name,
    email: user.email,
    password: user.password,
    callbackURL: '/signin',
  })
}

export async function signInByApi(
  page: Page,
  email: string,
  password: string = DEFAULT_PASSWORD,
): Promise<AuthRequestResult> {
  return postAuthRequest(page, SIGN_IN_ENDPOINTS, {
    email,
    password,
    rememberMe: true,
    callbackURL: '/chats/new',
  })
}

export async function authenticateUserByApi(
  page: Page,
  user: E2EAuthUser,
  protectedPath: string = '/chats/new',
): Promise<void> {
  const authResults: string[] = []

  try {
    const signUpResult = await signUpByApi(page, user)

    authResults.push(
      `Sign-up: ${formatAuthRequestResult(signUpResult)}`,
    )
  } catch (exception) {
    authResults.push(
      `Sign-up error: ${
        exception instanceof Error
          ? exception.message
          : String(exception)
      }`,
    )
  }

  await page.goto(protectedPath)
  await waitForHydration(page)

  if (page.url().includes('/signin')) {
    try {
      const signInResult = await signInByApi(page, user.email, user.password)

      authResults.push(
        `Sign-in: ${formatAuthRequestResult(signInResult)}`,
      )
    } catch (exception) {
      authResults.push(
        `Sign-in error: ${
          exception instanceof Error
            ? exception.message
            : String(exception)
        }`,
      )
    }

    await page.goto(protectedPath)
    await waitForHydration(page)
  }

  if (page.url().includes('/signin')) {
    throw new Error([
      'Authentication by API did not result in an authenticated session.',
      `Current URL: ${page.url()}`,
      ...authResults,
    ].join('\n'))
  }
}

export async function signIn(
  page: Page,
  email: string = 'test@example.com',
  password: string = DEFAULT_PASSWORD,
): Promise<void> {
  await page.goto('/signin')
  await waitForHydration(page)
  const form = page.locator('form')
  const emailInput = form.getByPlaceholder('example@example.com')
  const passwordInput = form.getByPlaceholder('Enter your password')
  const signInButton = form.getByRole('button', {
    name: 'Sign in',
    exact: true,
  })

  await expect(emailInput).toBeEditable()
  await expect(passwordInput).toBeEditable()
  await expect(signInButton).toBeEnabled()
  await typeInputValue(emailInput, email)
  await expect(emailInput).toHaveValue(email)
  await typeInputValue(passwordInput, password)
  await expect(emailInput).toHaveValue(email)
  await expect(passwordInput).toHaveValue(password)

  await Promise.all([
    page.waitForURL('/chats/new'),
    signInButton.click(),
  ])
}

export async function signUp(
  page: Page,
  userData: E2EAuthUser,
): Promise<void> {
  await signUpByApi(page, userData)
}

export async function signOut(page: Page): Promise<void> {
  await page.click('button[aria-label="Sign out"]')
  await page.waitForURL('/signin')
}

export async function isSignedIn(page: Page): Promise<boolean> {
  const currentUrl = page.url()

  return !currentUrl.includes('/signin') && !currentUrl.includes('/signup')
}
