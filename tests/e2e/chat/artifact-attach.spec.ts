import { execFileSync } from 'node:child_process'
import type { Page, Route } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
  authenticateUserByApi,
  createUniqueUser,
  waitForHydration,
} from '../helpers/auth'

const E2E_ADMIN_EMAIL = 'e2e-admin@example.com'
const QUIZ_ID = 'E2eAttachQuiz0001'
const FLOW_ID = 'E2eAttachFlow0001'
const UPDATED_AT = '2026-11-10T10:00:00.000Z'
const PAGE_SIZE = 20
const LIBRARY_SIZE = 25
const QUIZ_TITLE = 'Photosynthesis quiz'
const FLOW_TITLE = 'Release flow'
const SIDEBAR = '[data-testid="sidebar"]'
const CONTEXT_TRIGGER = '[data-testid="sidebar-chat-context"]'
const MENU_TRIGGER = 'chat-input-tools-trigger'
const ARTIFACT_ROW = 'artifact-row'
const PICKER = 'artifact-picker-dialog'

interface LibraryState {
  listRequests: URL[]
  newChatBodies: Array<{ parts: Array<Record<string, any>> }>
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
}

async function seedChat(page: Page): Promise<string> {
  const response = await page.request.put('/api/v1/chats/new', {
    data: {
      parts: [{ type: 'text', text: `Artifact attach ${Date.now()}` }],
      tools: [],
    },
  })

  expect(response.ok()).toBe(true)

  return (await response.json()).slug
}

const KIND_KEYS = ['html', 'react', 'svg', 'mermaid', 'markdown']

function countKinds(items: Array<{ kind: string }>): Record<string, number> {
  return Object.fromEntries(KIND_KEYS.map((kind) => {
    return [kind, items.filter(item => item.kind === kind).length]
  }))
}

function createSummary(index: number) {
  if (index === 1) {
    return summary(QUIZ_ID, QUIZ_TITLE, 'html', 'Biology help')
  }

  if (index === 2) {
    return summary(FLOW_ID, FLOW_TITLE, 'mermaid', null)
  }

  return summary(
    `E2eAttachFiller${String(index).padStart(3, '0')}`,
    `Filler ${index}`,
    'markdown',
    'Filler chat',
  )
}

function summary(
  id: string,
  title: string,
  kind: string,
  originChatTitle: string | null,
) {
  return {
    id,
    title,
    kind,
    currentVersion: 3,
    versionCount: 3,
    updatedAt: UPDATED_AT,
    originChatSlug: originChatTitle ? 'e2e-origin-chat' : null,
    originChatTitle,
    createdVia: 'chat',
    activeShareCount: 0,
    takenDown: false,
  }
}

async function mockLibrary(page: Page): Promise<LibraryState> {
  const state: LibraryState = { listRequests: [], newChatBodies: [] }
  const library = Array.from({ length: LIBRARY_SIZE }, (_value, index) => {
    return createSummary(index + 1)
  })

  await page.route(
    url => url.pathname === '/api/v1/artifacts',
    async (route) => {
      const url = new URL(route.request().url())
      const query = url.searchParams.get('query')?.toLowerCase() ?? ''
      const kind = url.searchParams.get('kind')
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const limit = Number(url.searchParams.get('limit') ?? PAGE_SIZE)
      const matches = library.filter((item) => {
        return (!kind || item.kind === kind)
          && (!query || item.title.toLowerCase().includes(query))
      })

      state.listRequests.push(url)
      await fulfillJson(route, {
        items: matches.slice(offset, offset + limit),
        total: matches.length,
        usedBytes: 4096,
        kindCounts: countKinds(library),
      })
    },
  )

  return state
}

async function openPicker(page: Page) {
  await page.getByTestId(MENU_TRIGGER).click()
  await page.getByTestId('tools-action-artifacts').click()
  await expect(page.getByTestId(PICKER)).toBeVisible()
}

test('attaches an artifact from the picker, shows a tile, sends it and '
  + 'lists it under Inputs', async ({ page }) => {
  await signInWithArtifacts(page)

  const chatSlug = await seedChat(page)
  const state = await mockLibrary(page)

  await page.route('**/api/v1/profiles/keys**', async (route) => {
    await fulfillJson(route, {
      keys: [{ provider: 'google', hasKey: true }],
    })
  })
  await page.route('**/api/v1/chats/new', async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.fallback()

      return
    }

    state.newChatBodies.push(route.request().postDataJSON())
    await fulfillJson(route, { slug: chatSlug })
  })

  await page.goto('/chats/new')
  await waitForHydration(page)
  await openPicker(page)

  const dialog = page.getByTestId(PICKER)

  await expect(dialog.getByTestId(ARTIFACT_ROW)).toHaveCount(PAGE_SIZE)
  await expect(dialog.getByTestId('artifact-picker-kind-all'))
    .toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByTestId('artifact-picker-kind-all-count'))
    .toHaveText(String(LIBRARY_SIZE))
  await expect(dialog.getByTestId('artifact-picker-kind-html-count'))
    .toHaveText('1')
  await expect(dialog.getByTestId('artifact-picker-kind-mermaid-count'))
    .toHaveText('1')
  await expect(dialog.getByTestId('artifact-picker-kind-react')).toHaveCount(0)
  await expect(dialog.getByTestId('artifact-picker-kind-svg')).toHaveCount(0)

  await dialog.getByTestId('artifact-row-open').first().click()

  await expect(dialog).toBeHidden()

  const tile = page.getByTestId(`chat-input-tile-artifact-${QUIZ_ID}`)

  await expect(tile).toContainText(QUIZ_TITLE)
  await expect(tile).toContainText('HTML')

  await page.getByTestId(`chat-input-tile-artifact-${QUIZ_ID}-remove`).click()
  await expect(tile).toHaveCount(0)

  await openPicker(page)
  await dialog.getByTestId('artifact-row-open').first().click()
  await expect(tile).toBeVisible()

  await page.route(
    url => url.pathname === `/api/v1/chats/${chatSlug}`,
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback()

        return
      }

      const response = await route.fetch()
      const chat = await response.json()

      chat.messages[0].parts = [
        { type: 'text', text: 'Change question 3 of the attached quiz' },
        {
          type: 'data-artifact-attachment',
          data: {
            artifactId: QUIZ_ID,
            version: 3,
            kind: 'html',
            title: QUIZ_TITLE,
          },
        },
      ]

      await fulfillJson(route, chat)
    },
  )
  await page.route(`**/api/v1/chats/${chatSlug}/context`, async (route) => {
    await fulfillJson(route, {
      chat: {
        slug: chatSlug,
        title: 'Attach chat',
        project: null,
        memoryExcluded: false,
        share: { active: false },
        cost: null,
        models: [],
      },
      outputs: [],
      inputs: [{
        id: `attached-artifact:${QUIZ_ID}`,
        sectionId: 'attached-artifacts',
        kind: 'artifact',
        title: QUIZ_TITLE,
        messageId: 'message-1',
        meta: {
          artifactId: QUIZ_ID,
          artifactKind: 'html',
          version: 3,
          latestVersion: 3,
        },
      }],
      used: [],
      counts: { outputs: 0, inputs: 1, used: 0 },
      truncated: false,
    })
  })

  await page.getByTestId('chat-input-textarea')
    .fill('Change question 3 of the attached quiz')
  await page.getByTestId('send-message').click()

  await expect.poll(() => state.newChatBodies.length).toBe(1)
  expect(state.newChatBodies[0]!.parts).toEqual([
    { type: 'text', text: 'Change question 3 of the attached quiz' },
    {
      type: 'data-artifact-attachment',
      data: {
        artifactId: QUIZ_ID,
        version: 3,
        kind: 'html',
        title: QUIZ_TITLE,
      },
    },
  ])

  await expect(page).toHaveURL(new RegExp(`/chats/${chatSlug}$`))

  const chip = page.getByTestId('message-artifact-attachment')

  await expect(chip).toContainText(QUIZ_TITLE)
  await expect(chip).toContainText('HTML · v3')

  await page.locator(SIDEBAR).hover()
  await page.locator(CONTEXT_TRIGGER).click()

  const inputs = page.getByTestId('chat-context-section-inputs')

  await expect(inputs.getByTestId('chat-context-item-artifact'))
    .toContainText(QUIZ_TITLE)
})

test('picker searches, filters by kind and loads more on demand',
  async ({ page }) => {
    await signInWithArtifacts(page)

    const state = await mockLibrary(page)

    await page.goto('/chats/new')
    await waitForHydration(page)

    expect(state.listRequests).toHaveLength(0)

    await openPicker(page)

    const dialog = page.getByTestId(PICKER)
    const rows = dialog.getByTestId(ARTIFACT_ROW)

    await expect(rows).toHaveCount(PAGE_SIZE)
    expect(state.listRequests).toHaveLength(1)
    expect(state.listRequests[0]!.searchParams.get('offset')).toBeNull()

    await dialog.getByTestId('artifact-picker-load-more').click()
    await expect(rows).toHaveCount(LIBRARY_SIZE)
    expect(state.listRequests.at(-1)!.searchParams.get('offset'))
      .toBe(String(PAGE_SIZE))

    await dialog.getByPlaceholder('Search artifacts...').fill('photo')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText(QUIZ_TITLE)
    expect(state.listRequests.at(-1)!.searchParams.get('query'))
      .toBe('photo')

    await dialog.getByPlaceholder('Search artifacts...').fill('zzzz')
    await expect(dialog.getByTestId('artifact-picker-no-results'))
      .toContainText('Nothing matches "zzzz"')

    await dialog.getByTestId('artifact-picker-clear').click()
    await expect(rows).toHaveCount(PAGE_SIZE)

    await dialog.getByTestId('artifact-picker-kind-mermaid').click()
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText(FLOW_TITLE)
    await expect(rows.first()).toContainText('Chat deleted')
    expect(state.listRequests.at(-1)!.searchParams.get('kind'))
      .toBe('mermaid')

    await dialog.getByTestId('artifact-picker-close').click()
    await expect(dialog).toBeHidden()
  })

test('a user without access sees the unchanged + Add menu and no picker '
  + 'request', async ({ page }) => {
  const user = createUniqueUser('e2e-no-artifacts')

  await authenticateUserByApi(page, user)

  const features = await page.request.get('/api/v1/features')

  expect((await features.json()).features.artifacts).toMatchObject({
    enabled: false,
    active: false,
  })

  const state = await mockLibrary(page)
  const listing = await page.request.get('/api/v1/artifacts')

  expect(listing.status()).toBe(404)
  state.listRequests.length = 0

  await page.goto('/chats/new')
  await waitForHydration(page)
  await page.getByTestId(MENU_TRIGGER).click()

  await expect(page.getByTestId('tools-action-attach')).toBeVisible()
  await expect(page.getByTestId('tools-action-library')).toBeVisible()
  await expect(page.getByTestId('tools-action-artifacts')).toHaveCount(0)
  await expect(page.getByText('Add artifact')).toHaveCount(0)
  await expect(page.getByTestId(PICKER)).toHaveCount(0)
  expect(state.listRequests).toHaveLength(0)
})
