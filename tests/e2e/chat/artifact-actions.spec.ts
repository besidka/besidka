import { execFileSync } from 'node:child_process'
import type { Page, Route } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
  authenticateUserByApi,
  createUniqueUser,
  waitForHydration,
} from '../helpers/auth'

const E2E_ADMIN_EMAIL = 'e2e-admin@example.com'
const ARTIFACT_ID = 'E2eActionsArtifact1'
const ORPHAN_ID = 'E2eActionsOrphan001'
const ARTIFACT_TITLE = 'Broken page'
const ORPHAN_TITLE = 'Orphan page'
const UPDATED_AT = '2026-11-10T10:00:00.000Z'
const BROKEN_CONTENT = [
  '<!doctype html>',
  '<html><body><h1>Broken</h1>',
  '<script>setTimeout(function () { throw new Error(\'E2E boom\') }, 50)',
  '</script></body></html>',
].join('')
const FIX_PROMPT_PREFIX = 'Fix the error in'
const SIDEBAR = '[data-testid="sidebar"]'
const CONTEXT_BADGE = '[data-testid="sidebar-chat-context-badge"]'

interface ActionsState {
  chatSlug: string
  deletedIds: string[]
  chatPosts: number
}

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 1440, height: 900 },
})

test.describe.configure({ mode: 'serial', timeout: 90_000 })

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: 'cookies_consent',
      value: JSON.stringify({
        v: 2,
        granted: ['necessary', 'preferences'],
        id: 'e2e-consent',
        date: new Date().toISOString(),
      }),
      domain: 'localhost',
      path: '/',
    },
  ])
})

function markEmailVerified(email: string) {
  execFileSync('pnpm', [
    'exec',
    'wrangler',
    'd1',
    'execute',
    'DB',
    '--local',
    '--command',
    `update users set email_verified = 1 where email = '${email}'`,
  ], { stdio: 'ignore' })
}

async function fulfillJson(route: Route, json: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'cache-control': 'private, no-store' },
    body: JSON.stringify(json),
  })
}

async function signInWithArtifacts(page: Page) {
  const admin = {
    ...createUniqueUser('e2e-admin'),
    name: 'E2E Admin',
    email: E2E_ADMIN_EMAIL,
  }

  await authenticateUserByApi(page, admin)
  markEmailVerified(E2E_ADMIN_EMAIL)

  const features = await page.request.get('/api/v1/features')

  expect((await features.json()).features.artifacts).toMatchObject({
    active: true,
  })

  await warmUpRoutes(page)
}

async function warmUpRoutes(page: Page) {
  const slug = await seedChat(page)

  await page.goto(`/chats/${slug}`)
  await page.waitForLoadState('networkidle')
  await page.goto('/chats/artifacts')
  await waitForHydration(page)
}

async function seedChat(page: Page): Promise<string> {
  const response = await page.request.put('/api/v1/chats/new', {
    data: {
      parts: [{ type: 'text', text: `Artifact actions ${Date.now()}` }],
      tools: [],
    },
  })

  expect(response.ok()).toBe(true)

  return (await response.json()).slug
}

function createSummary(
  id: string,
  title: string,
  originChatSlug: string | null,
) {
  return {
    id,
    title,
    kind: 'html',
    currentVersion: 1,
    versionCount: 1,
    updatedAt: UPDATED_AT,
    originChatSlug,
    originChatTitle: originChatSlug ? 'Actions chat' : null,
    createdVia: 'chat',
    activeShareCount: 0,
    takenDown: false,
  }
}

async function mockArtifactRoutes(
  page: Page,
  chatSlug: string,
): Promise<ActionsState> {
  const state: ActionsState = { chatSlug, deletedIds: [], chatPosts: 0 }
  const seed = [
    createSummary(ARTIFACT_ID, ARTIFACT_TITLE, chatSlug),
    createSummary(ORPHAN_ID, ORPHAN_TITLE, null),
  ]

  await page.route(
    (url) => {
      return url.pathname.startsWith('/api/v1/artifacts/')
        && !url.pathname.includes('/delete/')
    },
    async (route) => {
      const { pathname } = new URL(route.request().url())
      const id = pathname.split('/')[4]
      const artifact = seed.find(item => item.id === id)

      if (!artifact || state.deletedIds.includes(artifact.id)) {
        await fulfillJson(route, { message: 'Artifact not found' }, 404)

        return
      }

      if (pathname.endsWith('/versions/1')) {
        await fulfillJson(route, {
          artifactId: artifact.id,
          version: 1,
          kind: 'html',
          title: artifact.title,
          content: BROKEN_CONTENT,
          sizeBytes: BROKEN_CONTENT.length,
          createdAt: UPDATED_AT,
        })

        return
      }

      await fulfillJson(route, {
        ...artifact,
        totalBytes: BROKEN_CONTENT.length,
        createdAt: UPDATED_AT,
        versions: [{
          version: 1,
          sizeBytes: BROKEN_CONTENT.length,
          createdBy: 'model',
          createdAt: UPDATED_AT,
        }],
      })
    },
  )
  await page.route(
    url => url.pathname === '/api/v1/artifacts',
    async (route) => {
      const items = seed.filter((item) => {
        return !state.deletedIds.includes(item.id)
      })

      await fulfillJson(route, {
        items,
        total: items.length,
        usedBytes: items.length * 4096,
      })
    },
  )
  await page.route('**/api/v1/artifacts/delete/bulk', async (route) => {
    const { ids } = route.request().postDataJSON() as { ids: string[] }

    state.deletedIds.push(...ids)
    await fulfillJson(route, { deletedIds: ids, heldIds: [] })
  })
  await page.route(
    url => /^\/api\/v1\/chats\/[^/]+$/.test(url.pathname),
    async (route) => {
      if (route.request().method() === 'POST') {
        state.chatPosts += 1
      }

      await route.fallback()
    },
  )
  await page.route(
    url => url.pathname === `/api/v1/chats/${chatSlug}`,
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback()

        return
      }

      const response = await route.fetch()
      const chat = await response.json()

      chat.title = 'Actions chat'

      chat.messages.push({
        id: 'e2e-assistant-artifact',
        role: 'assistant',
        parts: [
          {
            type: 'data-artifact',
            data: {
              artifactId: ARTIFACT_ID,
              version: 1,
              kind: 'html',
              title: ARTIFACT_TITLE,
            },
          },
          { type: 'text', text: 'Here is your page.' },
        ],
        tools: [],
        reasoning: 'off',
        createdAt: UPDATED_AT,
        usage: null,
      })

      await fulfillJson(route, chat)
    },
  )
  await page.route(`**/api/v1/chats/${chatSlug}/context`, async (route) => {
    const outputs = state.deletedIds.includes(ARTIFACT_ID)
      ? []
      : [{
        id: `artifact:${ARTIFACT_ID}`,
        sectionId: 'artifacts',
        kind: 'artifact',
        title: ARTIFACT_TITLE,
        messageId: 'e2e-assistant-artifact',
        meta: { artifactId: ARTIFACT_ID, version: 1, latestVersion: 1 },
      }]

    await fulfillJson(route, {
      chat: {
        slug: chatSlug,
        title: 'Actions chat',
        project: null,
        memoryExcluded: false,
        share: { active: false },
        cost: null,
        models: [],
      },
      outputs,
      inputs: [],
      used: [],
      counts: { outputs: outputs.length, inputs: 0, used: 0 },
      truncated: false,
    })
  })

  return state
}

async function navigateInApp(page: Page, path: string) {
  await page.evaluate((target) => {
    const root = document.querySelector('#__nuxt') as unknown as {
      __vue_app__: {
        config: {
          globalProperties: { $router: { push: (to: string) => unknown } }
        }
      }
    }

    return root.__vue_app__.config.globalProperties.$router.push(target)
  }, path)
}

async function openLibraryRow(page: Page, id: string) {
  await page.goto('/chats/new')
  await waitForHydration(page)
  await navigateInApp(page, '/chats/artifacts')

  await page
    .locator(`[data-testid="artifact-row"][data-artifact-id="${id}"]`)
    .getByTestId('artifact-row-open')
    .click()

  await expect(page.getByTestId('artifact-detail')).toBeVisible()
  await expect(page.getByTestId('artifact-runtime-error'))
    .toContainText('E2E boom', { timeout: 20_000 })
}

async function expectPrefilledComposer(page: Page) {
  const composer = page.getByTestId('chat-input-textarea')

  await expect(composer).toHaveValue(new RegExp(`^${FIX_PROMPT_PREFIX} `), {
    timeout: 15_000,
  })
  await expect(composer).toBeFocused()

  const caretAtEnd = await composer.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement

    return textarea.selectionStart === textarea.value.length
      && textarea.selectionEnd === textarea.value.length
  })

  expect(caretAtEnd).toBe(true)
}

test('Ask to fix from History opens the origin chat with the prompt '
  + 'prefilled and the artifact in the panel', async ({ page }) => {
  await signInWithArtifacts(page)

  const chatSlug = await seedChat(page)
  const state = await mockArtifactRoutes(page, chatSlug)

  await openLibraryRow(page, ARTIFACT_ID)
  await page.getByTestId('artifact-ask-to-fix').click()

  await expect(page).toHaveURL(new RegExp(`/chats/${chatSlug}$`))
  await expectPrefilledComposer(page)
  await expect(page.getByTestId('artifact-detail')).toBeVisible()
  await expect(page.getByTestId('artifact-detail'))
    .toHaveAttribute('data-source', 'owner')
  expect(state.chatPosts).toBe(0)
})

test('Ask to fix for a deleted origin chat explains it and starts a new '
  + 'chat with the prompt prefilled', async ({ page }) => {
  await signInWithArtifacts(page)

  const chatSlug = await seedChat(page)
  const state = await mockArtifactRoutes(page, chatSlug)

  await openLibraryRow(page, ORPHAN_ID)

  await expect(page.getByTestId('artifact-ask-to-fix')).toHaveCount(0)
  await expect(page.getByTestId('artifact-fix-no-chat'))
    .toHaveText('The chat that created this artifact was deleted.')

  await page.getByTestId('artifact-start-new-chat').click()

  await expect(page).toHaveURL(/\/chats\/new$/)
  await expectPrefilledComposer(page)
  expect(state.chatPosts).toBe(0)
})

test('Ask to fix inside the origin chat fills the composer in place',
  async ({ page }) => {
    await signInWithArtifacts(page)

    const chatSlug = await seedChat(page)
    const state = await mockArtifactRoutes(page, chatSlug)

    await page.goto('/chats/new')
    await waitForHydration(page)
    await navigateInApp(page, `/chats/${chatSlug}`)

    await page.getByTestId('artifact-card').click()
    await expect(page.getByTestId('artifact-runtime-error'))
      .toContainText('E2E boom', { timeout: 20_000 })
    await page.getByTestId('artifact-ask-to-fix').click()

    await expect(page).toHaveURL(new RegExp(`/chats/${chatSlug}$`))
    await expectPrefilledComposer(page)
    expect(state.chatPosts).toBe(0)
  })

test('deletes an artifact from the panel after a confirmation',
  async ({ page }) => {
    await signInWithArtifacts(page)

    const chatSlug = await seedChat(page)
    const state = await mockArtifactRoutes(page, chatSlug)

    await page.goto('/chats/new')
    await waitForHydration(page)
    await navigateInApp(page, `/chats/${chatSlug}`)
    await page.locator(SIDEBAR).hover()
    await expect(page.locator(CONTEXT_BADGE)).toHaveText('1', {
      timeout: 15_000,
    })

    await page.getByTestId('artifact-card').click()
    await expect(page.getByTestId('artifact-detail')).toBeVisible()
    await page.getByTestId('artifact-actions').click()

    const deleteAction = page.getByTestId('artifact-detail')
      .getByTestId('artifact-action-delete')

    await expect(deleteAction).toBeVisible()
    await deleteAction.click()

    const dialog = page.locator('dialog[open]').filter({
      hasText: `Delete "${ARTIFACT_TITLE}"?`,
    })

    await expect(dialog).toContainText('active share links stop working')
    await expect(dialog).toContainText('placeholder')
    await dialog.getByTestId('confirmation-decline').click()
    expect(state.deletedIds).toEqual([])
    await expect(page.getByTestId('artifact-detail')).toBeVisible()

    await page.getByTestId('artifact-actions').click()
    await deleteAction.click()
    await dialog.getByTestId('confirmation-action-0').click()

    await expect(page.getByTestId('artifact-detail')).toHaveCount(0)
    await expect(page.getByTestId('artifact-card-deleted'))
      .toContainText('Artifact deleted')
    expect(state.deletedIds).toEqual([ARTIFACT_ID])

    await page.locator(SIDEBAR).hover()
    await expect(page.locator(CONTEXT_BADGE)).toHaveCount(0)

    await navigateInApp(page, '/chats/artifacts')
    await expect(
      page.locator(`[data-artifact-id="${ARTIFACT_ID}"]`),
    ).toHaveCount(0)
  })
