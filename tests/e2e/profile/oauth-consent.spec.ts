import type { Page } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  createUniqueUser,
  signIn,
  signUpByApi,
  waitForHydration,
} from '../helpers/auth'

const CLIENT_REDIRECT_URI = 'https://oauth-client.example/callback'
const CLAUDE_REQUESTED_SCOPES = [
  'chats:read',
  'projects:read',
  'memory:read',
  'files:read',
  'settings:read',
  'projects:write',
  'memory:write',
  'chats:write',
  'files:write',
  'settings:write',
  'data:delete',
  'offline_access',
].join(' ')
const RESOURCE_ONLY_SCOPES = 'chats:read chats:write projects:read'
const CONSENT_URL_PATTERN = /\/oauth\/consent\?/
const SIGN_IN_URL_PATTERN = /\/signin\?/

interface AuthorizationRequest {
  path: string
  state: string
}

async function registerClient(page: Page): Promise<string> {
  const baseUrl = test.info().project.use.baseURL!
  const response = await page.request.post('/api/auth/oauth2/register', {
    headers: { Origin: new URL(baseUrl).origin },
    data: {
      client_name: 'E2E Connector',
      redirect_uris: [CLIENT_REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  })

  expect(response.ok(), await response.text()).toBe(true)

  const body = await response.json()

  return body.client_id
}

async function createAuthorizationRequest(
  page: Page,
  scope: string = CLAUDE_REQUESTED_SCOPES,
): Promise<AuthorizationRequest> {
  const clientId = await registerClient(page)
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(8).toString('hex')
  const baseUrl = test.info().project.use.baseURL!
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CLIENT_REDIRECT_URI,
    scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: `${baseUrl}/mcp`,
    prompt: 'consent',
  })

  return {
    path: `/api/auth/oauth2/authorize?${params.toString()}`,
    state,
  }
}

async function interceptClientCallback(page: Page): Promise<void> {
  await page.route(`${CLIENT_REDIRECT_URI}**`, async (route) => {
    await route.fulfill({ status: 200, body: 'callback reached' })
  })
}

async function clickAndWaitForClientCallback(
  page: Page,
  testId: string,
): Promise<URL> {
  const callbackRequest = page.waitForRequest((request) => {
    return request.url().startsWith(CLIENT_REDIRECT_URI)
  })

  await page.getByTestId(testId).click()

  return new URL((await callbackRequest).url())
}

async function waitForApproveButtonHydration(page: Page): Promise<void> {
  await expect.poll(async () => {
    return page.getByTestId('oauth-consent-approve').evaluate((element) => {
      return '__vnode' in element
    })
  }).toBe(true)
}

function collectHydrationErrors(page: Page): string[] {
  const hydrationErrors: string[] = []

  page.on('console', (message) => {
    if (message.text().includes('Hydration')) {
      hydrationErrors.push(message.text())
    }
  })

  return hydrationErrors
}

test.describe('OAuth consent before the app hydrates', () => {
  test.use({ javaScriptEnabled: false })

  test('approves through the native form', async ({ page }) => {
    test.setTimeout(30_000)

    await interceptClientCallback(page)

    const request = await createAuthorizationRequest(page)

    await page.goto(request.path)
    await expect(page).toHaveURL(CONSENT_URL_PATTERN)

    const callbackUrl = await clickAndWaitForClientCallback(
      page,
      'oauth-consent-approve',
    )

    expect(callbackUrl.searchParams.get('code')).toBeTruthy()
    expect(callbackUrl.searchParams.get('state')).toBe(request.state)
    expect(callbackUrl.searchParams.get('error')).toBeNull()
  })

  test('denies through the native form', async ({ page }) => {
    test.setTimeout(30_000)

    await interceptClientCallback(page)

    const request = await createAuthorizationRequest(page)

    await page.goto(request.path)
    await expect(page).toHaveURL(CONSENT_URL_PATTERN)

    const callbackUrl = await clickAndWaitForClientCallback(
      page,
      'oauth-consent-deny',
    )

    expect(callbackUrl.searchParams.get('error')).toBe('access_denied')
    expect(callbackUrl.searchParams.get('code')).toBeNull()
  })
})

test.describe('OAuth consent after hydration', () => {
  test('first open hydrates cleanly without identity scopes', async ({
    page,
  }) => {
    test.setTimeout(30_000)

    const hydrationErrors = collectHydrationErrors(page)

    await interceptClientCallback(page)

    const request = await createAuthorizationRequest(
      page,
      RESOURCE_ONLY_SCOPES,
    )

    await page.goto(request.path)
    await expect(page).toHaveURL(CONSENT_URL_PATTERN)
    await waitForHydration(page)
    await waitForApproveButtonHydration(page)

    expect(hydrationErrors).toEqual([])

    const consentResponse = page.waitForResponse((response) => {
      return response.url().endsWith('/api/auth/oauth2/consent')
    })

    const callbackUrl = await clickAndWaitForClientCallback(
      page,
      'oauth-consent-approve',
    )

    expect((await consentResponse).ok()).toBe(true)

    expect(callbackUrl.searchParams.get('code')).toBeTruthy()
  })
})

test.describe('OAuth consent after switching account', () => {
  test.use({
    storageState: {
      cookies: [],
      origins: [],
    },
  })

  test('approves for the account signed in on the way back', async ({
    page,
  }) => {
    test.setTimeout(60_000)

    const firstUser = createUniqueUser('oauth-consent-first')
    const secondUser = createUniqueUser('oauth-consent-second')

    await signUpByApi(page, firstUser)
    await signUpByApi(page, secondUser)
    await page.context().clearCookies()
    await interceptClientCallback(page)

    const request = await createAuthorizationRequest(page)

    await page.goto(request.path)
    await expect(page).toHaveURL(SIGN_IN_URL_PATTERN)

    let signInUrl = new URL(page.url())

    await signIn(page, firstUser.email, firstUser.password, {
      startPath: `${signInUrl.pathname}${signInUrl.search}`,
      expectedUrl: CONSENT_URL_PATTERN,
    })
    await waitForApproveButtonHydration(page)
    await expect(page.getByTestId('oauth-signed-in-email'))
      .toHaveText(firstUser.email)

    await page.getByTestId('oauth-switch-account').click()
    await expect(page).toHaveURL(SIGN_IN_URL_PATTERN)

    signInUrl = new URL(page.url())

    await signIn(page, secondUser.email, secondUser.password, {
      startPath: `${signInUrl.pathname}${signInUrl.search}`,
      expectedUrl: CONSENT_URL_PATTERN,
    })
    await expect(page.getByTestId('oauth-signed-in-email'))
      .toHaveText(secondUser.email)
    await waitForApproveButtonHydration(page)

    const callbackUrl = await clickAndWaitForClientCallback(
      page,
      'oauth-consent-approve',
    )

    expect(callbackUrl.searchParams.get('code')).toBeTruthy()
    expect(callbackUrl.searchParams.get('state')).toBe(request.state)
  })
})
