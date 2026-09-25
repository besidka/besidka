import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'

const GATEWAY_TEST_MODEL_ID = 'google/gemini-3.1-flash-image'
const GATEWAY_TEST_MODEL_NAME = 'Gateway Test Image Model'

interface ImageCardSample {
  progress: number
  ready: number
  hiddenProgress: number
}

type WindowWithImageCardSampler = typeof window & {
  __imageCardSamples?: ImageCardSample[]
  __imageCardSamplerHandle?: number
}

test.describe.configure({
  mode: 'serial',
  timeout: 45_000,
})

test.beforeEach(async ({ page }) => {
  await page.route(
    '**/api/v1/gateways/vercel/models**',
    async (route) => {
      await route.fulfill({
        json: {
          gateway: 'vercel',
          models: [
            {
              id: GATEWAY_TEST_MODEL_ID,
              name: GATEWAY_TEST_MODEL_NAME,
              modalities: { input: ['text'], output: ['text', 'image'] },
              supportsImageGeneration: true,
              toolCall: false,
            },
          ],
        },
      })
    },
  )

  await page.route(
    '**/api/v1/profiles/keys**',
    async (route) => {
      await route.fulfill({
        json: {
          keys: [{ provider: 'vercel-gateway', hasKey: true }],
        },
      })
    },
  )
})

async function selectGatewayTestModel(page: Page): Promise<void> {
  await page.locator('[data-testid="current-model-trigger"]').click()
  await page.locator('[data-testid="models-picker-gateway-vercel"]').click()
  await page.getByRole(
    'button',
    { name: `Choose ${GATEWAY_TEST_MODEL_NAME}`, exact: true },
  ).click()
}

async function startImageCardSampler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const sampledWindow = window as WindowWithImageCardSampler

    sampledWindow.__imageCardSamples = []

    function sample() {
      sampledWindow.__imageCardSamples?.push({
        progress: document.querySelectorAll(
          '[data-testid="generated-image-progress"]',
        ).length,
        ready: document.querySelectorAll(
          '[data-testid="generated-image-ready"]',
        ).length,
        hiddenProgress: document.querySelectorAll(
          '[data-role="assistant"][data-hide-content="true"] '
          + '[data-testid="generated-image-progress"]',
        ).length,
      })
      sampledWindow.__imageCardSamplerHandle
        = requestAnimationFrame(sample)
    }

    sample()
  })
}

async function stopImageCardSampler(
  page: Page,
): Promise<ImageCardSample[]> {
  return page.evaluate(() => {
    const sampledWindow = window as WindowWithImageCardSampler

    cancelAnimationFrame(sampledWindow.__imageCardSamplerHandle ?? 0)

    return sampledWindow.__imageCardSamples ?? []
  })
}

test('gateway image turn shows the pending card before the first chunk, '
  + 'keeps it through streamed text, then swaps to the image with no '
  + 'second bubble', async ({ page }) => {
  await page.goto('/chats/test?scenario=gateway-image')
  await waitForHydration(page)

  await selectGatewayTestModel(page)

  await page.locator('textarea').fill('A scottish fold cat by a fireplace')

  await startImageCardSampler(page)
  await page.getByRole('button', { name: 'Send Message' }).click()

  await expect(
    page.locator('[data-testid="generated-image-progress"]'),
  ).toBeVisible({ timeout: 2_000 })

  await expect(
    page.locator('[data-role="assistant"] .js-message-text'),
  ).toContainText('scottish fold', { timeout: 10_000 })

  await expect(
    page.locator('[data-testid="generated-image-progress"]'),
  ).toBeVisible()
  await expect(
    page.locator('[data-testid="generated-image"]'),
  ).toHaveCount(1)

  await expect(
    page.locator('[data-testid="generated-image-ready"]'),
  ).toBeVisible({ timeout: 15_000 })

  const samples = await stopImageCardSampler(page)

  expect(samples.length).toBeGreaterThan(10)

  for (const sample of samples) {
    expect(sample.progress + sample.ready).toBeLessThanOrEqual(1)
    expect(sample.hiddenProgress).toBe(0)
  }

  expect(samples.at(-1)?.ready).toBe(1)

  await expect(
    page.locator('[data-testid="generated-image"]'),
  ).toHaveCount(1)
  await expect(
    page.locator('[data-testid="generated-image-progress"]'),
  ).toHaveCount(0)
})

test('locks image generation on /chats/new for a gateway image-only model '
  + 'restored from a saved default, overriding a saved Brave + low '
  + 'reasoning default and hiding the search/reasoning triggers, even '
  + 'when the model also reports tool-calling and reasoning support',
async ({ page, context }) => {
  await page.route(
    '**/api/v1/gateways/vercel/models**',
    async (route) => {
      await new Promise(resolve => setTimeout(resolve, 1_000))

      await route.fulfill({
        json: {
          gateway: 'vercel',
          models: [
            {
              id: GATEWAY_TEST_MODEL_ID,
              name: GATEWAY_TEST_MODEL_NAME,
              modalities: { input: ['text'], output: ['text', 'image'] },
              supportsImageGeneration: true,
              supportsWebSearch: 'native',
              supportsReasoning: true,
              toolCall: true,
            },
          ],
        },
      })
    },
  )

  await context.addCookies([
    {
      name: 'cookies_consent',
      value: JSON.stringify({
        v: 1,
        granted: ['necessary', 'preferences'],
        id: 'e2e-consent',
        date: new Date().toISOString(),
      }),
      domain: 'localhost',
      path: '/',
    },
  ])

  await page.addInitScript(
    ({ modelId }) => {
      window.localStorage.setItem(
        'model',
        JSON.stringify({
          source: 'gateway',
          gatewayId: 'vercel',
          modelId,
        }),
      )
      window.localStorage.setItem(
        'settings_web_search_tool',
        'web_search_brave',
      )
      window.localStorage.setItem('settings_reasoning_level', 'low')
    },
    { modelId: GATEWAY_TEST_MODEL_ID },
  )

  await page.goto('/chats/new')
  await waitForHydration(page)

  const createImageButton = page.getByRole('button', {
    name: 'Image creation is required for this model',
  })

  await expect(createImageButton).toBeVisible({ timeout: 15_000 })
  await expect(createImageButton).toHaveClass(/btn-active/)

  await expect(
    page.locator('[data-testid="web-search-trigger"]'),
  ).toHaveCount(0)
  await expect(
    page.locator('[data-testid="reasoning-trigger"]'),
  ).toHaveCount(0)

  let capturedBody: Record<string, unknown> | null = null

  await page.route('**/api/v1/chats/new', async (route) => {
    capturedBody = route.request().postDataJSON()

    await route.fulfill({
      json: { slug: 'e2e-gateway-image-required' },
    })
  })

  await page.locator('textarea').fill('draw me a cat')
  await page.getByRole('button', { name: 'Send Message' }).click()

  await expect
    .poll(() => capturedBody)
    .not.toBeNull()

  expect(capturedBody).toMatchObject({
    tools: ['image_generation'],
    reasoning: 'off',
  })
})

test('first turn sent from /chats/new shows the pending image card '
  + 'instead of the generic loader while the gateway send resumes after '
  + 'the new-chat navigation', async ({ page, context }) => {
  const chatSlug = 'e2e-first-turn-gateway-image'
  const firstChunkDelayMs = 2_000

  await context.addCookies([
    {
      name: 'cookies_consent',
      value: JSON.stringify({
        v: 1,
        granted: ['necessary', 'preferences'],
        id: 'e2e-consent',
        date: new Date().toISOString(),
      }),
      domain: 'localhost',
      path: '/',
    },
  ])

  await page.addInitScript(
    ({ modelId }) => {
      window.localStorage.setItem(
        'model',
        JSON.stringify({
          source: 'gateway',
          gatewayId: 'vercel',
          modelId,
        }),
      )
    },
    { modelId: GATEWAY_TEST_MODEL_ID },
  )

  await page.route('**/api/v1/chats/new', async (route) => {
    await route.fulfill({ json: { slug: chatSlug } })
  })

  await page.route(`**/api/v1/chats/${chatSlug}/title`, async (route) => {
    await route.fulfill({ json: { title: 'A scottish fold cat' } })
  })

  await page.route(`**/api/v1/chats/${chatSlug}`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        json: {
          id: 1,
          slug: chatSlug,
          title: '',
          projectId: null,
          branchedFromShareSlug: null,
          activeResearchJob: null,
          messages: [
            {
              id: 'e2e-first-turn-user-message',
              publicId: 'e2e-first-turn-user-message',
              role: 'user',
              parts: [
                {
                  type: 'text',
                  text: 'A scottish fold cat by a fireplace',
                },
              ],
              tools: ['image_generation'],
              reasoning: 'off',
              createdAt: new Date().toISOString(),
              usage: null,
            },
          ],
        },
      })

      return
    }

    const requestUrl = new URL(route.request().url())
    const testEndpointUrl = `${requestUrl.origin}/api/v1/chats/test`
      + `?scenario=gateway-image&initialDelay=${firstChunkDelayMs}`
    const response = await route.fetch({ url: testEndpointUrl })

    await route.fulfill({ response })
  })

  await page.goto('/chats/new')
  await waitForHydration(page)

  await page.locator('textarea').fill('A scottish fold cat by a fireplace')
  await page.getByRole('button', { name: 'Send Message' }).click()
  await page.waitForURL(`**/chats/${chatSlug}`)

  await expect(
    page.locator('[data-testid="generated-image-progress"]'),
  ).toBeVisible({ timeout: firstChunkDelayMs - 500 })

  await expect(
    page.locator('[data-testid="chat-loader"]'),
  ).toHaveClass(/opacity-0/)

  await expect(
    page.locator('[data-role="assistant"] .js-message-text'),
  ).toContainText('scottish fold', { timeout: 10_000 })

  await expect(
    page.locator('[data-testid="generated-image-ready"]'),
  ).toBeVisible({ timeout: 15_000 })
})
