import { execFileSync } from 'node:child_process'
import type { Page, Route } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
  authenticateUserByApi,
  createUniqueUser,
  waitForHydration,
} from '../helpers/auth'

const E2E_ADMIN_EMAIL = 'e2e-admin@example.com'
const LIVE_ID = 'E2eLibLiveArtifact1'
const DELETED_CHAT_ID = 'E2eLibOrphanArtifa1'
const MCP_ID = 'E2eLibMcpArtifact01'
const UNKNOWN_ID = 'E2eLibUnknownArtif01'
const UPDATED_AT = '2026-11-09T10:00:00.000Z'
const LIVE_CONTENT = '<!doctype html><html><body><h1>Quiz</h1></body></html>'

type SeedArtifact = {
  id: string
  title: string
  kind: string
  currentVersion: number
  versionCount: number
  updatedAt: string
  originChatSlug: string | null
  originChatTitle: string | null
  createdVia: 'chat' | 'mcp'
  activeShareCount: number
  takenDown: boolean
}

interface LibraryState {
  items: SeedArtifact[]
  deletedBatches: string[][]
  shareCreated: boolean
}

function createSeed(): SeedArtifact[] {
  return [
    {
      id: LIVE_ID,
      title: 'Photosynthesis quiz',
      kind: 'html',
      currentVersion: 2,
      versionCount: 2,
      updatedAt: UPDATED_AT,
      originChatSlug: 'e2e-library-chat',
      originChatTitle: 'Biology help',
      createdVia: 'chat',
      activeShareCount: 0,
      takenDown: false,
    },
    {
      id: DELETED_CHAT_ID,
      title: 'Orphan landing page',
      kind: 'html',
      currentVersion: 1,
      versionCount: 1,
      updatedAt: UPDATED_AT,
      originChatSlug: null,
      originChatTitle: null,
      createdVia: 'chat',
      activeShareCount: 0,
      takenDown: false,
    },
    {
      id: MCP_ID,
      title: 'Cell diagram',
      kind: 'mermaid',
      currentVersion: 1,
      versionCount: 1,
      updatedAt: UPDATED_AT,
      originChatSlug: null,
      originChatTitle: null,
      createdVia: 'mcp',
      activeShareCount: 0,
      takenDown: false,
    },
  ]
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

function toDetail(artifact: SeedArtifact) {
  return {
    ...artifact,
    totalBytes: 1200,
    createdAt: UPDATED_AT,
    versions: Array.from({ length: artifact.versionCount }, (_value, index) => {
      return {
        version: index + 1,
        sizeBytes: 600,
        createdBy: 'model',
        createdAt: UPDATED_AT,
      }
    }),
  }
}

async function mockLibraryRoutes(page: Page): Promise<LibraryState> {
  const state: LibraryState = {
    items: createSeed(),
    deletedBatches: [],
    shareCreated: false,
  }
  const sharesUrl = `**/api/v1/artifacts/${LIVE_ID}/shares`

  await page.route(
    (url) => {
      return url.pathname.startsWith('/api/v1/artifacts/')
        && !url.pathname.includes('/delete/')
    },
    async (route) => {
      const { pathname } = new URL(route.request().url())
      const id = pathname.split('/')[4]
      const artifact = state.items.find(item => item.id === id)

      if (pathname.endsWith('/versions/2') && artifact) {
        await fulfillJson(route, {
          artifactId: artifact.id,
          version: 2,
          kind: artifact.kind,
          title: artifact.title,
          content: LIVE_CONTENT,
          sizeBytes: LIVE_CONTENT.length,
          createdAt: UPDATED_AT,
        })

        return
      }

      if (pathname.split('/').length === 5 && artifact) {
        await fulfillJson(route, toDetail(artifact))

        return
      }

      if (pathname.split('/').length === 5) {
        await fulfillJson(route, { message: 'Artifact not found' }, 404)

        return
      }

      await route.fallback()
    },
  )
  await page.route(
    url => url.pathname === '/api/v1/artifacts',
    async (route) => {
      await fulfillJson(route, {
        items: state.items,
        total: state.items.length,
        usedBytes: state.items.length * 4096,
      })
    },
  )
  await page.route('**/api/v1/artifacts/delete/bulk', async (route) => {
    const { ids } = route.request().postDataJSON() as { ids: string[] }

    state.deletedBatches.push(ids)
    state.items = state.items.filter(item => !ids.includes(item.id))

    await fulfillJson(route, { deletedIds: ids, heldIds: [] })
  })
  await page.route(`${sharesUrl}/check`, async (route) => {
    await fulfillJson(route, { warnings: [] })
  })
  await page.route(sharesUrl, async (route) => {
    const origin = new URL(route.request().url()).origin
    const share = {
      shareId: 'sh_e2e_lib',
      url: `${origin}/a/e2eLibraryShareToken`,
      createdVia: 'ui',
      clientName: null,
      pinnedVersion: null,
      expiresAt: null,
      revokedAt: null,
      takedownAt: null,
      storageAllowed: false,
      bridgeAllowed: false,
      createdAt: UPDATED_AT,
      status: 'active',
    }

    if (route.request().method() === 'POST') {
      state.shareCreated = true
      state.items = state.items.map((item) => {
        return item.id === LIVE_ID ? { ...item, activeShareCount: 1 } : item
      })
      await fulfillJson(route, { share, url: share.url })

      return
    }

    await fulfillJson(route, {
      shares: state.shareCreated ? [share] : [],
    })
  })

  return state
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
  const payload = await features.json()

  expect(payload.features.artifacts).toMatchObject({ active: true })
  expect(payload.features['artifacts.share']).toMatchObject({ active: true })
}

async function openLibrary(page: Page, path = '/chats/artifacts') {
  await page.goto('/chats/new')
  await waitForHydration(page)

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

function getRow(page: Page, id: string) {
  return page.locator(`[data-testid="artifact-row"][data-artifact-id="${id}"]`)
}

test('lists artifacts from chats, deleted chats and connected apps',
  async ({ page }) => {
    await signInWithArtifacts(page)
    await mockLibraryRoutes(page)
    await openLibrary(page)

    await expect(page.getByTestId('tab-artifacts'))
      .toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('artifact-row')).toHaveCount(3)

    const liveRow = getRow(page, LIVE_ID)

    await expect(liveRow).toContainText('Photosynthesis quiz')
    await expect(liveRow.getByTestId('artifact-row-origin-link'))
      .toHaveText('Biology help')
    await expect(liveRow.getByTestId('artifact-row-origin-link'))
      .toHaveAttribute('href', '/chats/e2e-library-chat')
    await expect(getRow(page, DELETED_CHAT_ID).getByTestId(
      'artifact-row-origin',
    )).toHaveText('Chat deleted')
    await expect(getRow(page, MCP_ID).getByTestId('artifact-row-origin'))
      .toHaveText('Created by a connected app')
    await expect(page.getByTestId('artifact-library-usage'))
      .toHaveText('Using 12.0 KB of 25.0 MB')
  })

test('opens the artifact in the side panel from a row and a deep link',
  async ({ page }) => {
    await signInWithArtifacts(page)
    await mockLibraryRoutes(page)
    await openLibrary(page)

    await getRow(page, LIVE_ID).getByTestId('artifact-row-open').click()

    await expect(page.getByTestId('artifact-detail')).toBeVisible()

    await openLibrary(page, `/chats/artifacts?artifact=${MCP_ID}`)

    await expect(page.getByTestId('artifact-detail')).toBeVisible()
    await expect(page).toHaveURL(/\/chats\/artifacts$/)
  })

test('warns about an unknown artifact in a deep link and lets the user '
  + 'dismiss it', async ({ page }) => {
  await signInWithArtifacts(page)
  await mockLibraryRoutes(page)
  await openLibrary(page, `/chats/artifacts?artifact=${UNKNOWN_ID}`)

  const notice = page.getByTestId('artifact-library-notice')

  await expect(notice).toContainText('This artifact is not available')
  await expect(page.getByTestId('artifact-detail')).toHaveCount(0)

  await page.getByTestId('artifact-library-notice-dismiss').click()

  await expect(notice).toHaveCount(0)
})

test('shares an artifact from the row actions and marks the row as shared',
  async ({ page }) => {
    await signInWithArtifacts(page)
    await mockLibraryRoutes(page)
    await openLibrary(page)

    const liveRow = getRow(page, LIVE_ID)

    await liveRow.hover()
    await liveRow.getByTestId('artifact-row-actions-trigger').click()
    await liveRow.getByTestId('artifact-action-share').click()

    const modal = page.getByTestId('artifact-share-modal')

    await expect(modal).toBeVisible()
    await expect(modal).toContainText('Photosynthesis quiz')

    await page.getByTestId('artifact-share-create').click()
    await expect(page.getByTestId('artifact-share-created')).toBeVisible()
    await page.getByTestId('artifact-share-close').click()

    await expect(liveRow.getByTestId('artifact-row-shared-badge'))
      .toHaveText('Shared')
  })

test('filters by kind and search and keeps them in the URL',
  async ({ page }) => {
    await signInWithArtifacts(page)

    const state = await mockLibraryRoutes(page)

    await openLibrary(page)

    await page.getByTestId('artifact-library-kind-mermaid').click()

    await expect(page).toHaveURL(/kind=mermaid/)

    await page.goBack()

    await expect(page).not.toHaveURL(/kind=/)
    await expect(page.getByTestId('artifact-library-kind-all'))
      .toHaveAttribute('aria-checked', 'true')

    state.items = []
    await page.getByPlaceholder('Search artifacts...').fill('zzz')

    await expect(page).toHaveURL(/query=zzz/)
    await expect(page.getByTestId('artifact-library-no-results'))
      .toContainText('Nothing matches "zzz"')

    await page.getByTestId('artifact-library-clear').click()

    await expect(page).not.toHaveURL(/query=/)
  })

test('bulk deletes the selected artifacts after a confirmation',
  async ({ page }) => {
    await signInWithArtifacts(page)

    const state = await mockLibraryRoutes(page)

    await openLibrary(page)

    const firstRow = getRow(page, DELETED_CHAT_ID)

    await firstRow.hover()
    await firstRow.getByTestId('artifact-row-actions-trigger').click()
    await firstRow.getByTestId('artifact-action-select').click()
    await getRow(page, MCP_ID).getByTestId('artifact-row-checkbox').click()

    await page.getByTestId('bulk-delete').click()

    await expect(page.getByRole('dialog')).toContainText(
      'Deletes 2 artifacts, their versions and share links. '
      + 'Viewers\' saved progress is deleted too. This cannot be undone.',
    )

    await page.getByTestId('confirmation-action-0').click()

    await expect(page.getByTestId('artifact-row')).toHaveCount(1)
    await expect(getRow(page, LIVE_ID)).toBeVisible()
    expect(state.deletedBatches).toEqual([[DELETED_CHAT_ID, MCP_ID]])
    await expect(page.getByTestId('artifact-library-usage'))
      .toHaveText('Using 4.0 KB of 25.0 MB')
  })

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true })

  test('fits four tabs without horizontal scroll and keeps only the active '
    + 'label', async ({ page }) => {
    await signInWithArtifacts(page)
    await mockLibraryRoutes(page)
    await openLibrary(page)

    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth
    })

    expect(hasHorizontalScroll).toBe(false)
    await expect(page.getByTestId('tab-artifacts')).toBeVisible()
    await expect(page.getByTestId('tab-artifacts')).toContainText('Artifacts')

    const inactiveLabelBox = await page
      .getByTestId('tab-chats')
      .getByText('Chats')
      .boundingBox()

    expect(inactiveLabelBox?.width ?? 0).toBeLessThanOrEqual(1)
    await expect(page.getByTestId('tab-chats'))
      .toHaveAttribute('aria-label', 'Chats')
  })
})
