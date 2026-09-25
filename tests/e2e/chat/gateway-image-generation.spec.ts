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
