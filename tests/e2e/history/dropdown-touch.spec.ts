import { devices, expect, test } from '@playwright/test'

const iPhone12 = devices['iPhone 12']

test.use({
  viewport: iPhone12.viewport,
  screen: iPhone12.screen,
  deviceScaleFactor: iPhone12.deviceScaleFactor,
  isMobile: iPhone12.isMobile,
  hasTouch: iPhone12.hasTouch,
  userAgent: iPhone12.userAgent,
})

const historyResponse = {
  pinned: [
    {
      id: 'chat-1',
      slug: 'chat-1',
      title: 'Pinned chat',
      createdAt: '2026-03-01T08:00:00.000Z',
      activityAt: '2026-03-11T08:00:00.000Z',
      pinnedAt: '2026-03-11T08:00:00.000Z',
      projectId: 'project-1',
      projectName: 'Project 1',
    },
  ],
  chats: [],
  nextCursor: null,
}

const projectsResponse = {
  pinned: [
    {
      id: 'project-1',
      name: 'Project 1',
      pinnedAt: '2026-03-11T08:00:00.000Z',
      archivedAt: null,
      activityAt: '2026-03-11T08:00:00.000Z',
      createdAt: '2026-03-01T08:00:00.000Z',
    },
  ],
  projects: [],
}

const projectChatsResponse = {
  project: projectsResponse.pinned[0],
  pinned: [],
  chats: [
    {
      id: 'chat-2',
      slug: 'chat-2',
      title: 'Project chat',
      createdAt: '2026-03-01T08:00:00.000Z',
      activityAt: '2026-03-11T08:00:00.000Z',
      pinnedAt: null,
      projectId: 'project-1',
      projectName: 'Project 1',
    },
  ],
  nextCursor: null,
}

test.describe('history touch dropdowns', () => {
  test('opens chat actions on history page', async ({ page }) => {
    await page.route('**/api/v1/chats/history**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(historyResponse),
      })
    })

    await page.goto('/chats/history')

    await page.getByTestId('history-chat-actions-trigger').first().click()

    await expect(page.getByRole('button', { name: 'Rename' })).toBeVisible()
  })

  test('opens project actions on projects page', async ({ page }) => {
    await page.route('**/api/v1/projects?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(projectsResponse),
      })
    })
    await page.route('**/api/v1/projects', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(projectsResponse),
      })
    })

    await page.goto('/chats/projects')

    await page.getByTestId('history-project-actions-trigger').first().click()

    await expect(page.getByRole('button', { name: 'Rename' })).toBeVisible()
  })

  test('opens chat actions on project detail page', async ({ page }) => {
    await page.route('**/api/v1/projects?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(projectsResponse),
      })
    })
    await page.route('**/api/v1/projects', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(projectsResponse),
      })
    })
    await page.route('**/api/v1/projects/project-1/chats**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(projectChatsResponse),
      })
    })
    await page.route('**/api/v1/projects/project-1', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'project-1',
          name: 'Project 1',
          instructions: null,
          memory: null,
          memoryStatus: 'idle',
          memoryUpdatedAt: null,
          memoryDirtyAt: null,
          memoryProvider: null,
          memoryModel: null,
          memoryError: null,
        }),
      })
    })

    await page.goto('/chats/projects')
    await page.getByRole('link', { name: 'Open project Project 1' }).click()
    await page.waitForURL('**/chats/projects/project-1')

    await page.getByTestId('history-chat-actions-trigger').first().click()

    await expect(page.getByRole('button', { name: 'Rename' })).toBeVisible()
  })
})
