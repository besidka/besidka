import type {
  Browser,
  BrowserContext,
  Locator,
  Page,
} from '@playwright/test'
import { expect, test } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'

const SHARE_TOKEN = 'e2eExitToken_0123456789abcdefghijklmnopqrst'
const INVALID_PATH = '/artifacts/not-a-share-token'
const SHARED_CHAT_PATH = '/shared/test'
const ARTIFACT_PATH = `/artifacts/${SHARE_TOKEN}`
const ARTIFACT_TITLE = 'Capitals quiz'
const ARTIFACT_CONTENT = '<!doctype html><html><body><h1>Quiz</h1></body></html>'
const DESKTOP_VIEWPORT = { width: 1440, height: 900 }
const PHONE_VIEWPORT = { width: 375, height: 812 }
const SIGNED_IN_STATE_PATH = '.playwright/auth-user.json'
const SIGNED_OUT_STATE = { cookies: [], origins: [] }

const CONSENT_COOKIE = {
  name: 'cookies_consent',
  value: JSON.stringify({
    v: 2,
    granted: ['necessary', 'preferences'],
    id: 'e2e-consent',
    date: new Date().toISOString(),
  }),
  domain: 'localhost',
  path: '/',
}

type DisplayMode = 'tab' | 'standalone'
type Viewer = 'signed-out' | 'signed-in'

const DISPLAY_MODES: DisplayMode[] = ['tab', 'standalone']
const VIEWERS: Array<{ viewer: Viewer, destination: string }> = [
  { viewer: 'signed-out', destination: '/' },
  { viewer: 'signed-in', destination: '/chats/new' },
]

async function emulateStandaloneDisplay(page: Page) {
  await page.addInitScript(() => {
    const originalMatchMedia = window.matchMedia.bind(window)

    window.matchMedia = (query: string) => {
      const result = originalMatchMedia(query)

      if (!query.includes('display-mode: standalone')) {
        return result
      }

      return new Proxy(result, {
        get(target, key) {
          if (key === 'matches') {
            return true
          }

          const value = Reflect.get(target, key)

          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    }

    Object.defineProperty(navigator, 'standalone', { value: true })
  })
}

async function mockArtifactShare(page: Page) {
  await page.route('**/api/v1/artifact-shares/current', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'private, no-store' },
      body: JSON.stringify({
        shareId: 'sh_exit',
        artifactId: 'E2eExitArtifact01',
        title: ARTIFACT_TITLE,
        kind: 'html',
        version: 1,
        pinned: false,
        content: ARTIFACT_CONTENT,
        createdAt: '2026-11-09T10:00:00.000Z',
        expiresAt: '2026-11-16T10:00:00.000Z',
        capabilities: { storageAllowed: false, bridgeAllowed: false },
      }),
    })
  })
}

async function readBox(locator: Locator) {
  const box = await locator.boundingBox()

  if (!box) {
    throw new Error('Element has no bounding box')
  }

  return box
}

async function horizontalGap(
  left: Locator,
  right: Locator,
): Promise<number> {
  const leftBox = await readBox(left)
  const rightBox = await readBox(right)

  return rightBox.x - (leftBox.x + leftBox.width)
}

async function verticalGap(
  upper: Locator,
  lower: Locator,
): Promise<number> {
  const upperBox = await readBox(upper)
  const lowerBox = await readBox(lower)

  return lowerBox.y - (upperBox.y + upperBox.height)
}

async function rightEdge(locator: Locator): Promise<number> {
  const box = await readBox(locator)

  return box.x + box.width
}

async function openContext(
  browser: Browser,
  viewer: Viewer,
  viewport: { width: number, height: number },
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport,
    storageState: viewer === 'signed-in'
      ? SIGNED_IN_STATE_PATH
      : SIGNED_OUT_STATE,
  })

  await context.addCookies([CONSENT_COOKIE])

  return context
}

async function openPage(
  context: BrowserContext,
  mode: DisplayMode,
  path: string,
): Promise<Page> {
  const page = await context.newPage()

  if (mode === 'standalone') {
    await emulateStandaloneDisplay(page)
  }

  if (path.startsWith('/artifacts/') && path !== INVALID_PATH) {
    await mockArtifactShare(page)
  }

  await page.goto(path)
  await waitForHydration(page)

  return page
}

for (const mode of DISPLAY_MODES) {
  for (const { viewer, destination } of VIEWERS) {
    test.describe(`${viewer} in ${mode}`, () => {
      test(
        `artifact page offers a way home to ${destination}`,
        async ({ browser }) => {
          const context = await openContext(browser, viewer, DESKTOP_VIEWPORT)
          const page = await openPage(context, mode, ARTIFACT_PATH)
          const exitLink = page.getByTestId('shared-exit-link')
          const reportButton = page.getByTestId('artifact-share-report')
          const frame = page.getByTestId('artifact-share-frame')

          await expect(page.getByTestId('artifact-share-title'))
            .toHaveText(ARTIFACT_TITLE)
          await expect(exitLink).toBeVisible()
          await expect(exitLink).toHaveAttribute('href', destination)
          await expect(reportButton).toBeVisible()

          await expect.poll(() => {
            return horizontalGap(exitLink, reportButton)
          }).toBeGreaterThanOrEqual(0)
          await expect.poll(() => {
            return verticalGap(exitLink, frame)
          }).toBeGreaterThanOrEqual(0)

          await exitLink.click()
          await page.waitForURL(url => url.pathname === destination)
          await context.close()
        },
      )

      test('artifact error page keeps the way home', async ({ browser }) => {
        const context = await openContext(browser, viewer, DESKTOP_VIEWPORT)
        const page = await openPage(context, mode, INVALID_PATH)
        const exitLink = page.getByTestId('shared-exit-link')

        await expect(page.getByTestId('artifact-share-not-found'))
          .toBeVisible()
        await expect(exitLink).toBeVisible()
        await expect(exitLink).toHaveAttribute('href', destination)
        await context.close()
      })

      test(
        `shared chat page offers a way home to ${destination}`,
        async ({ browser }) => {
          const context = await openContext(browser, viewer, DESKTOP_VIEWPORT)
          const page = await openPage(context, mode, SHARED_CHAT_PATH)
          const exitLink = page.getByTestId('shared-exit-link')

          await expect(page.getByTestId('shared-chat-title')).toBeVisible()
          await expect(exitLink).toBeVisible()
          await expect(exitLink).toHaveAttribute('href', destination)

          await exitLink.click()
          await page.waitForURL(url => url.pathname === destination)
          await context.close()
        },
      )
    })
  }

  test.describe(`phone in ${mode}`, () => {
    test('artifact page shows the icon-only way home', async ({ browser }) => {
      const context = await openContext(browser, 'signed-out', PHONE_VIEWPORT)
      const page = await openPage(context, mode, ARTIFACT_PATH)
      const exitLink = page.getByTestId('shared-exit-link')
      const reportButton = page.getByTestId('artifact-share-report')

      await expect(exitLink).toBeVisible()
      await expect(exitLink).toHaveAccessibleName('Open Besidka')

      await expect.poll(() => {
        return horizontalGap(exitLink, reportButton)
      }).toBeGreaterThanOrEqual(0)
      await expect.poll(() => {
        return rightEdge(reportButton)
      }).toBeLessThanOrEqual(PHONE_VIEWPORT.width)
      await context.close()
    })

    test('shared chat page relies on the nav pill home', async ({ browser }) => {
      const context = await openContext(browser, 'signed-out', PHONE_VIEWPORT)
      const page = await openPage(context, mode, SHARED_CHAT_PATH)

      await expect(page.getByTestId('shared-chat-title')).toBeVisible()
      await expect(page.getByTestId('shared-exit-link')).toBeHidden()
      await expect(
        page.getByTestId('sidebar').getByRole('link', {
          name: 'Go to home page',
        }),
      ).toBeInViewport()
      await context.close()
    })
  })
}
