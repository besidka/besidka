import type { Page, Route } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
  authenticateUserByApi,
  createUniqueUser,
  waitForHydration,
} from '../helpers/auth'

test.use({ storageState: { cookies: [], origins: [] } })

test.describe.configure({ timeout: 60_000 })

const PROMPT = 'Explain how a lease works'
const FRESH_ANSWER = 'A lease is a lock that expires.'

function streamBody(chunks: Record<string, unknown>[]): string {
  return [
    ...chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`),
    'data: [DONE]\n\n',
  ].join('')
}

async function seedChat(page: Page): Promise<string> {
  const response = await page.request.put('/api/v1/chats/new', {
    data: {
      parts: [{ type: 'text', text: PROMPT }],
      tools: [],
    },
  })

  expect(response.ok()).toBe(true)

  return (await response.json()).slug
}

test('Stop tells the server, and Retry right after gets a reply',
  async ({ page }) => {
    await authenticateUserByApi(page, createUniqueUser('e2e-stop-retry'))
    await page.route('**/api/v1/profiles/keys**', async (route: Route) => {
      await route.fulfill({
        json: { keys: [{ provider: 'google', hasKey: true }] },
      })
    })

    const chatSlug = await seedChat(page)
    const sendBodies: Array<Record<string, unknown>> = []
    let releaseFirstSend: () => void = () => {}
    const firstSendReleased = new Promise<void>((resolve) => {
      releaseFirstSend = resolve
    })

    await page.route(
      url => url.pathname === `/api/v1/chats/${chatSlug}`,
      async (route: Route) => {
        if (route.request().method() !== 'POST') {
          await route.fallback()

          return
        }

        sendBodies.push(route.request().postDataJSON())

        if (sendBodies.length === 1) {
          await firstSendReleased
          await route.abort().catch(() => undefined)

          return
        }

        await route.fulfill({
          status: 200,
          headers: {
            'content-type': 'text/event-stream',
            'x-vercel-ai-ui-message-stream': 'v1',
          },
          body: streamBody([
            { type: 'start', messageId: 'e2e-stop-retry-answer' },
            { type: 'start-step' },
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: FRESH_ANSWER },
            { type: 'text-end', id: 'text-1' },
            { type: 'finish-step' },
            { type: 'finish' },
          ]),
        })
      },
    )

    const stopRequest = page.waitForRequest((request) => {
      return request.method() === 'POST'
        && new URL(request.url()).pathname
        === `/api/v1/chats/${chatSlug}/stop`
    })

    await page.goto(`/chats/${chatSlug}`)
    await waitForHydration(page)
    await expect.poll(() => sendBodies.length).toBe(1)

    const stopButton = page.getByTestId('stop-generation')

    await expect(stopButton).toBeVisible()
    await stopButton.click()

    const stop = await stopRequest
    const userMessageId = (
      sendBodies[0]!.messages as Array<{ id: string }>
    )[0]!.id

    expect(stop.postDataJSON()).toEqual({ messageId: userMessageId })
    expect((await stop.response())?.status()).toBe(200)
    releaseFirstSend()
    expect(sendBodies).toHaveLength(1)

    await page.getByTestId('regenerate').click()

    await expect(page.getByText(FRESH_ANSWER)).toBeVisible({ timeout: 30_000 })
    await expect(stopButton).toBeHidden()
    expect(sendBodies.length).toBeGreaterThanOrEqual(2)
    expect((sendBodies.at(-1)!.messages as Array<{ id: string }>)[0]!.id)
      .toBe(userMessageId)
    await expect(page.getByTestId('chat-loader-waiting')).toHaveCount(0)
  })
