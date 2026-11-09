import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { BrowserContext, FrameLocator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
  readEvalResults,
  resultPath,
  summariseCheckStatus,
} from '../../../scripts/artifact-evals.mjs'

const EVALS_ENABLED = process.env.ARTIFACT_EVALS === '1'
const BASE_URL = process.env.ARTIFACT_EVALS_BASE_URL ?? ''
const RESULTS_DIR = process.env.ARTIFACT_EVALS_DIR ?? ''
const INITIALISE_LIMIT_MS = 5_000
const CLICK_SETTLE_MS = 400
const CLICKABLE_WAIT_MS = 10_000
const MAX_CLICKS = 4
const CLICKABLE_SELECTOR = [
  'button:visible',
  '[role="button"]:visible',
  'input[type="radio"]:visible',
  'label:visible',
].join(', ')

interface EvalResult {
  caseId: string
  model: string
  chatSlug?: string
  status: string
  checks: Record<string, { status: string, note?: string }>
  artifacts?: { artifactId: string, kind: string }[]
}

function loadPendingResults(): EvalResult[] {
  if (!EVALS_ENABLED || !RESULTS_DIR || !existsSync(RESULTS_DIR)) {
    return []
  }

  return (readEvalResults(RESULTS_DIR) as EvalResult[]).filter((result) => {
    return result.chatSlug
      && result.artifacts?.length
      && result.checks.interactive
  })
}

async function signIn(context: BrowserContext) {
  const lines = readFileSync(process.env.ARTIFACT_EVALS_CREDS ?? '', 'utf8')
    .trim()
    .split('\n')

  await context.addCookies([{
    name: 'cookies_consent',
    value: JSON.stringify({
      v: 2,
      granted: ['necessary'],
      id: 'artifact-evals',
      date: new Date().toISOString(),
    }),
    url: BASE_URL,
  }])

  const response = await context.request.post(
    `${BASE_URL}/api/auth/sign-in/email`,
    {
      headers: { origin: BASE_URL },
      data: { email: lines[0], password: lines[1] },
    },
  )

  expect(response.status(), 'sign-in status').toBe(200)
}

async function openArtifact(page: Page): Promise<number> {
  const panel = page.getByTestId('side-panel')

  if (!await panel.isVisible().catch(() => false)) {
    await page.getByTestId('artifact-card').last().click()
  }

  const startedAt = Date.now()
  const frame = page.frameLocator('[data-testid="artifact-frame-iframe"]')

  await expect.poll(() => readFrameText(frame), {
    timeout: 15_000,
  }).not.toBe('')

  return Date.now() - startedAt
}

async function readFrameText(frame: FrameLocator): Promise<string> {
  return frame.locator('body').innerText().catch(() => '')
}

async function clickThrough(frame: FrameLocator): Promise<boolean> {
  await expect.poll(() => frame.locator(CLICKABLE_SELECTOR).count(), {
    timeout: CLICKABLE_WAIT_MS,
  }).toBeGreaterThan(0).catch(() => {})

  const initialText = await readFrameText(frame)

  for (let index = 0; index < MAX_CLICKS; index++) {
    const clickable = frame.locator(CLICKABLE_SELECTOR).nth(index)

    if (!await clickable.count()) {
      break
    }

    await clickable.click({ timeout: 3_000 }).catch(() => {})
    await new Promise(resolve => setTimeout(resolve, CLICK_SETTLE_MS))

    if (await readFrameText(frame) !== initialText) {
      return true
    }
  }

  return false
}

function writeBack(result: EvalResult) {
  const path = resultPath(RESULTS_DIR, result.model, result.caseId)
  const stored = JSON.parse(readFileSync(path, 'utf8'))

  stored.checks = result.checks
  stored.status = summariseCheckStatus(result.checks)
  writeFileSync(path, `${JSON.stringify(stored, null, 2)}\n`)
}

test.describe('artifact eval renders', () => {
  test.skip(!EVALS_ENABLED, 'Opt-in: set ARTIFACT_EVALS=1 (see docs/artifacts.md)')
  test.describe.configure({ mode: 'serial' })
  test.use({ storageState: { cookies: [], origins: [] } })

  let context: BrowserContext

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: 'block',
    })
    await signIn(context)
  })

  test.afterAll(async () => {
    await context?.close()
  })

  for (const result of loadPendingResults()) {
    test(`${result.model} ${result.caseId}`, async () => {
      const page = await context.newPage()
      const securityMessages: string[] = []
      const storageWrites: string[] = []

      page.on('console', (message) => {
        const text = message.text()

        if (/Content Security Policy|Refused to/i.test(text)) {
          securityMessages.push(text.slice(0, 200))
        }
      })
      page.on('request', (request) => {
        if (
          request.method() === 'PUT'
          && /\/api\/v1\/artifacts\/[^/]+\/storage\//.test(request.url())
        ) {
          storageWrites.push(request.url())
        }
      })

      let initialiseMs = Number.POSITIVE_INFINITY
      let changed = false
      let failure = ''

      try {
        await page.goto(`${BASE_URL}/chats/${result.chatSlug}`, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        })
        initialiseMs = await openArtifact(page)
        changed = await clickThrough(
          page.frameLocator('[data-testid="artifact-frame-iframe"]'),
        )
      } catch (exception) {
        failure = exception instanceof Error
          ? exception.message.split('\n')[0] ?? ''
          : String(exception)
      }
      const notes = [
        failure,
        Number.isFinite(initialiseMs)
          ? `initialised in ${initialiseMs} ms`
          : '',
        storageWrites.length ? `${storageWrites.length} storage write(s)` : '',
        securityMessages.length
          ? `CSP: ${securityMessages[0]}`
          : '',
      ].filter(Boolean)

      result.checks.interactive = {
        status: changed && initialiseMs <= INITIALISE_LIMIT_MS
          ? 'pass'
          : 'fail',
        note: changed ? notes.join('; ') : `no DOM change; ${notes.join('; ')}`,
      }
      if (result.checks.interactive.status === 'fail') {
        await page.screenshot({
          path: resultPath(RESULTS_DIR, result.model, result.caseId)
            .replace(/\.json$/, '.png'),
        })
      }

      writeBack(result)
      await page.close()
      test.info().annotations.push({
        type: 'interactive',
        description: result.checks.interactive.status,
      })
    })
  }
})
