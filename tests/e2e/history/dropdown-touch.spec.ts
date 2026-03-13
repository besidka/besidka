import { devices, expect, test } from '@playwright/test'

test.use({
  ...devices['iPhone 12'],
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
      folderId: 'folder-1',
      folderName: 'Folder 1',
    },
  ],
  chats: [],
  nextCursor: null,
}

const foldersResponse = {
  pinned: [
    {
      id: 'folder-1',
      name: 'Folder 1',
      pinnedAt: '2026-03-11T08:00:00.000Z',
      archivedAt: null,
      activityAt: '2026-03-11T08:00:00.000Z',
      createdAt: '2026-03-01T08:00:00.000Z',
    },
  ],
  folders: [],
}

const folderChatsResponse = {
  folder: foldersResponse.pinned[0],
  pinned: [],
  chats: [
    {
      id: 'chat-2',
      slug: 'chat-2',
      title: 'Folder chat',
      createdAt: '2026-03-01T08:00:00.000Z',
      activityAt: '2026-03-11T08:00:00.000Z',
      pinnedAt: null,
      folderId: 'folder-1',
      folderName: 'Folder 1',
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

  test('opens folder actions on folders page', async ({ page }) => {
    await page.route('**/api/v1/folders?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(foldersResponse),
      })
    })
    await page.route('**/api/v1/folders', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(foldersResponse),
      })
    })

    await page.goto('/chats/folders')

    await page.getByTestId('history-folder-actions-trigger').first().click()

    await expect(page.getByRole('button', { name: 'Rename' })).toBeVisible()
  })

  test('opens chat actions on folder detail page', async ({ page }) => {
    await page.route('**/api/v1/folders?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(foldersResponse),
      })
    })
    await page.route('**/api/v1/folders', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(foldersResponse),
      })
    })
    await page.route('**/api/v1/folders/folder-1/chats**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(folderChatsResponse),
      })
    })

    await page.goto('/chats/folders')
    await page.getByRole('link', { name: 'Open folder Folder 1' }).click()

    await page.getByTestId('history-chat-actions-trigger').first().click()

    await expect(page.getByRole('button', { name: 'Rename' })).toBeVisible()
  })
})
