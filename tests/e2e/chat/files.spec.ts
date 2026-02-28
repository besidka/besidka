import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'

const DEFAULT_MAX_STORAGE_BYTES = 20 * 1024 * 1024
const DEFAULT_MAX_FILES_PER_MESSAGE = 10
const DEFAULT_MAX_MESSAGE_FILES_BYTES = 1000 * 1024 * 1024

interface MockFileRecord {
  id: string
  userId: number
  storageKey: string
  name: string
  size: number
  type: string
  source: 'upload' | 'assistant'
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}

async function setupFileApiMocks(page: Page): Promise<void> {
  const files: MockFileRecord[] = []
  let fileCounter = 0

  await page.route(/\/api\/v1\/files(?:\/.*)?(?:\?.*)?$/, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const pathname = url.pathname
    const method = request.method()

    if (pathname === '/api/v1/files/policy' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          policy: {
            tier: 'vip',
            maxStorageBytes: DEFAULT_MAX_STORAGE_BYTES,
            maxFilesPerMessage: DEFAULT_MAX_FILES_PER_MESSAGE,
            maxMessageFilesBytes: DEFAULT_MAX_MESSAGE_FILES_BYTES,
            fileRetentionDays: null,
            imageTransformLimitTotal: 100,
            imageTransformUsedTotal: 0,
          },
          globalTransformRemainingMonth: 1000,
        }),
      })
    }

    if (pathname === '/api/v1/files/upload' && method === 'PUT') {
      const headers = request.headers()
      const filename = decodeURIComponent(
        headers['x-filename'] || `mock-file-${fileCounter + 1}.txt`,
      )
      const size = Number(headers['x-filesize'] || 0)
      const type = headers['content-type'] || 'text/plain'
      const now = new Date().toISOString()
      const nextCounter = fileCounter + 1
      const file: MockFileRecord = {
        id: `mock-file-${nextCounter}`,
        userId: 1,
        storageKey: `users/1/mock/${nextCounter}-${filename}`,
        name: filename,
        size,
        type,
        source: 'upload',
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      }

      fileCounter = nextCounter
      files.unshift(file)

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(file),
      })
    }

    if (pathname === '/api/v1/files' && method === 'GET') {
      const offset = Number(url.searchParams.get('offset') || 0)
      const limit = Number(url.searchParams.get('limit') || 20)
      const search = (url.searchParams.get('search') || '')
        .trim()
        .toLowerCase()
      const filteredFiles = search.length
        ? files.filter(file => file.name.toLowerCase().includes(search))
        : files

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          files: filteredFiles.slice(offset, offset + limit),
          total: filteredFiles.length,
          offset,
          limit,
        }),
      })
    }

    if (pathname === '/api/v1/files/delete/bulk' && method === 'POST') {
      const body = request.postData() || '{}'
      const parsedBody = JSON.parse(body) as { ids?: string[] }
      const idsToDelete = new Set(parsedBody.ids || [])

      for (let index = files.length - 1; index >= 0; index--) {
        const file = files[index]

        if (file && idsToDelete.has(file.id)) {
          files.splice(index, 1)
        }
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
        }),
      })
    }

    if (pathname.startsWith('/api/v1/files/') && method === 'DELETE') {
      const id = pathname.split('/').at(-1)
      const fileIndex = files.findIndex(file => file.id === id)

      if (fileIndex >= 0) {
        files.splice(fileIndex, 1)
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
        }),
      })
    }

    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        statusMessage: 'Not found',
      }),
    })
  })

  await page.route('**/api/v1/storage', async (route) => {
    const used = files.reduce((total, file) => {
      return total + file.size
    }, 0)
    const percentage = Math.round(
      (used / DEFAULT_MAX_STORAGE_BYTES) * 100,
    )

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        used,
        total: DEFAULT_MAX_STORAGE_BYTES,
        percentage,
        tier: 'vip',
        maxStorageBytes: DEFAULT_MAX_STORAGE_BYTES,
        maxFilesPerMessage: DEFAULT_MAX_FILES_PER_MESSAGE,
        maxMessageFilesBytes: DEFAULT_MAX_MESSAGE_FILES_BYTES,
        fileRetentionDays: null,
        imageTransformLimitTotal: 100,
        imageTransformUsedTotal: 0,
        globalTransformRemainingMonth: 1000,
      }),
    })
  })
}

async function openFilesModal(
  page: Page,
  action: 'Upload new files' | 'Select existing files',
): Promise<void> {
  const trigger = page.getByTestId('files-trigger')
  const actionTestId = action === 'Upload new files'
    ? 'files-open-upload'
    : 'files-open-select'

  await trigger.hover()
  await trigger.evaluate((element) => {
    const details = element.closest('details') as HTMLDetailsElement | null

    if (details) {
      details.open = true
    }
  })

  const actionButton = page.getByTestId(actionTestId)

  await expect(actionButton).toBeVisible()
  await expect(page.getByTestId('files-modal')).toBeAttached({ timeout: 10000 })
  await actionButton.evaluate((element) => {
    ;(element as HTMLButtonElement).click()
  })
  await expect(page.getByTestId('files-modal')).toBeVisible()
  await page.getByRole('radio', {
    name: action,
    exact: true,
  }).check()
}

async function uploadTextFile(page: Page, filename: string): Promise<void> {
  await openFilesModal(page, 'Upload new files')
  await expect(page.getByTestId('files-upload-input')).toBeAttached({
    timeout: 15000,
  })
  await page.getByTestId('files-upload-input').setInputFiles({
    name: filename,
    mimeType: 'text/plain',
    buffer: Buffer.from('file e2e content'),
  })
  await expect(page.getByLabel(`Remove ${filename}`)).toBeVisible({
    timeout: 15000,
  })
}

async function detachFile(page: Page, filename: string): Promise<void> {
  await page.getByLabel(`Remove ${filename}`).click()
  await page.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByLabel(`Remove ${filename}`)).toHaveCount(0)
}

async function attachExistingFile(
  page: Page,
  filename: string,
): Promise<void> {
  await openFilesModal(page, 'Select existing files')
  await page.locator('[data-file-index="0"]').first().click()
  await page.getByTestId('files-attach-selected').click()
  await expect(page.getByLabel(`Remove ${filename}`)).toBeVisible({
    timeout: 15000,
  })
}

async function deleteSelectedFile(page: Page, filename: string): Promise<void> {
  await openFilesModal(page, 'Select existing files')
  await page.locator('[data-file-index="0"]').first().click()

  const deleteSelectedButton = page.getByTestId('files-delete-selected')

  await expect(deleteSelectedButton).toBeVisible()
  await deleteSelectedButton.evaluate((element) => {
    ;(element as HTMLButtonElement).click()
  })
  await page.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByLabel(`Remove ${filename}`)).toHaveCount(0)
}

test.describe.configure({
  mode: 'serial',
  timeout: 60000,
})

test.describe('Chat Files', () => {
  test.beforeEach(async ({ page }) => {
    await setupFileApiMocks(page)
    await page.goto('/chats/new')
    await waitForHydration(page)
    await expect(page.getByTestId('files-trigger')).toBeVisible()
  })

  test('uploads a file and shows attached preview', async ({ page }) => {
    const filename = 'upload-preview.txt'

    await uploadTextFile(page, filename)
  })

  test('attaches an existing file after detaching it', async ({ page }) => {
    const filename = 'attach-existing.txt'

    await uploadTextFile(page, filename)
    await detachFile(page, filename)
    await attachExistingFile(page, filename)
  })

  test('deletes file from manager and detaches it from chat input', async ({
    page,
  }) => {
    const filename = 'delete-detach.txt'

    await uploadTextFile(page, filename)
    await deleteSelectedFile(page, filename)
  })
})
