import type { Page } from '@playwright/test'
import { devices, expect, test } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'

declare global {
  interface Window {
    __carouselScrollCalls: number
  }
}

const DEFAULT_MAX_STORAGE_BYTES = 20 * 1024 * 1024
const DEFAULT_MAX_FILES_PER_MESSAGE = 20
const DEFAULT_MAX_MESSAGE_FILES_BYTES = 1000 * 1024 * 1024
const UPLOAD_DELAY_MS = 300

interface CarouselMetrics {
  scrollLeft: number
  activeUploadingName?: string
  activeUploadingVisible: boolean
  newestAttachedName?: string
  newestAttachedVisible: boolean
  removeAllVisible: boolean
  scrollCalls: number
}

test.use({
  ...devices['iPhone 14 Pro Max'],
  defaultBrowserType: undefined,
})

test.describe.configure({
  mode: 'serial',
  timeout: 60_000,
})

async function setupSlowUploadMocks(page: Page): Promise<void> {
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
        headers['x-filename'] || 'mock-file.txt',
      )
      const size = Number(headers['x-filesize'] || 0)
      const type = headers['content-type'] || 'text/plain'
      const now = new Date().toISOString()
      const id = `mock-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const file = {
        id,
        userId: 1,
        storageKey: `users/1/mock/${id}-${filename}`,
        name: filename,
        size,
        type,
        source: 'upload',
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      }

      await new Promise(resolve => setTimeout(resolve, UPLOAD_DELAY_MS))

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(file),
      })
    }

    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ statusMessage: 'Not found' }),
    })
  })

  await page.route('**/api/v1/storage', async (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        used: 0,
        total: DEFAULT_MAX_STORAGE_BYTES,
        percentage: 0,
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

async function openUploadModal(page: Page): Promise<void> {
  const trigger = page.getByTestId('files-trigger')
  const moreOptionsButton = page.getByLabel('More options')

  if (await trigger.isVisible()) {
    await trigger.hover()
    await trigger.evaluate((element) => {
      const details = element.closest('details') as HTMLDetailsElement | null

      if (details) {
        details.open = true
      }
    })

    const actionButton = page.getByTestId('files-open-upload')

    await expect(actionButton).toBeVisible()
    await expect(page.getByTestId('files-modal')).toBeAttached({
      timeout: 10_000,
    })
    await actionButton.evaluate((element) => {
      ;(element as HTMLButtonElement).click()
    })
  } else {
    await expect(moreOptionsButton).toBeVisible()
    await moreOptionsButton.click()
    await page.getByRole('button', { name: 'Attach files' }).click()
  }

  await expect(page.getByTestId('files-modal')).toBeVisible()
  await page.getByRole('radio', { name: 'Upload new files', exact: true }).check()
}

async function getCarouselMetrics(page: Page): Promise<CarouselMetrics> {
  return page.evaluate(() => {
    const carousel = document.querySelector(
      '.attached-files .carousel',
    ) as HTMLElement | null

    if (!carousel) {
      return {
        scrollLeft: 0,
        activeUploadingVisible: false,
        newestAttachedVisible: false,
        removeAllVisible: false,
        scrollCalls: 0,
      }
    }

    const carouselRect = carousel.getBoundingClientRect()
    const activeUploading = carousel.querySelector(
      '[data-uploading-id]',
    ) as HTMLElement | null
    const attachedItems = Array.from(
      carousel.querySelectorAll('[data-testid="carousel-item"]'),
    ).filter((item): item is HTMLElement => {
      return item instanceof HTMLElement
    })
    const newestAttached = attachedItems.at(-1) || null
    const removeAllButton = carousel.querySelector(
      '[data-testid="files-preview-detach-all"]',
    ) as HTMLElement | null
    const removeAllItem = removeAllButton?.parentElement as HTMLElement | null
    const removeAllWidth = removeAllItem?.getBoundingClientRect().width || 0
    const effectiveRight = removeAllItem
      ? carouselRect.right - removeAllWidth
      : carouselRect.right
    const isFullyVisible = (item: HTMLElement | null) => {
      if (!item) {
        return false
      }

      const itemRect = item.getBoundingClientRect()

      return itemRect.left >= carouselRect.left
        && itemRect.right <= effectiveRight
    }
    const isFullyVisibleInViewport = (item: HTMLElement | null) => {
      if (!item) {
        return false
      }

      const itemRect = item.getBoundingClientRect()

      return itemRect.left >= carouselRect.left
        && itemRect.right <= carouselRect.right
    }

    return {
      scrollLeft: carousel.scrollLeft,
      activeUploadingName: activeUploading?.dataset.fileName,
      activeUploadingVisible: isFullyVisible(activeUploading),
      newestAttachedName: newestAttached?.dataset.fileName,
      newestAttachedVisible: isFullyVisible(newestAttached),
      removeAllVisible: isFullyVisibleInViewport(removeAllItem),
      scrollCalls: window.__carouselScrollCalls || 0,
    }
  })
}

async function setCarouselScrollLeft(page: Page, value: number): Promise<void> {
  await page.evaluate((scrollValue) => {
    const carousel = document.querySelector(
      '.attached-files .carousel',
    ) as HTMLElement | null

    if (carousel) {
      carousel.scrollLeft = scrollValue
    }
  }, value)
}

interface MockFile { name: string, mimeType: string, buffer: Buffer }

function makeFiles(count: number): MockFile[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `carousel-test-${index + 1}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from(`file content ${index + 1}`),
  }))
}

test.describe('Files carousel scroll during upload', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const nativeScrollTo = HTMLElement.prototype.scrollTo

      Object.defineProperty(window, '__carouselScrollCalls', {
        configurable: true,
        writable: true,
        value: 0,
      })

      HTMLElement.prototype.scrollTo = function (
        ...args: Parameters<HTMLElement['scrollTo']>
      ) {
        if (this.classList.contains('carousel')) {
          window.__carouselScrollCalls += 1
        }

        return nativeScrollTo.apply(this, args)
      }
    })

    await setupSlowUploadMocks(page)
    await page.goto('/chats/new')
    await waitForHydration(page)
    await expect.poll(async () => {
      return await page.getByTestId('files-trigger').isVisible()
        || await page.getByLabel('More options').isVisible()
    }, { timeout: 5_000 }).toBe(true)
  })

  test('carousel stays at scrollLeft 0 on initial file add (all waiting)', async ({
    page,
  }) => {
    await openUploadModal(page)
    await expect(page.getByTestId('files-upload-input')).toBeAttached({
      timeout: 15_000,
    })

    await page.getByTestId('files-upload-input').setInputFiles(makeFiles(8))

    await expect.poll(async () => {
      const metrics = await getCarouselMetrics(page)

      return metrics.scrollLeft === 0
        && metrics.activeUploadingName === 'carousel-test-1.txt'
        && metrics.activeUploadingVisible
    }, { timeout: 5_000 }).toBe(true)
  })

  test('reveals the active and newest processed items when uploads move right', async ({
    page,
  }) => {
    await openUploadModal(page)
    await expect(page.getByTestId('files-upload-input')).toBeAttached({
      timeout: 15_000,
    })

    await page.getByTestId('files-upload-input').setInputFiles(makeFiles(10))

    await expect.poll(async () => {
      const metrics = await getCarouselMetrics(page)

      return metrics.scrollCalls
    }, { timeout: 15_000 }).toBeGreaterThan(0)

    await expect.poll(async () => {
      const metrics = await getCarouselMetrics(page)

      return metrics.scrollLeft > 0
        && metrics.activeUploadingVisible
    }, { timeout: 15_000 }).toBe(true)
  })

  test('auto-scroll resumes after manual reset when the next processed item is hidden', async ({
    page,
  }) => {
    await openUploadModal(page)
    await expect(page.getByTestId('files-upload-input')).toBeAttached({
      timeout: 15_000,
    })

    await page.getByTestId('files-upload-input').setInputFiles(makeFiles(10))

    await expect.poll(async () => {
      const metrics = await getCarouselMetrics(page)

      return metrics.scrollLeft > 0
        && metrics.scrollCalls > 0
    }, { timeout: 15_000 }).toBe(true)

    const metricsBeforeManualReset = await getCarouselMetrics(page)

    await setCarouselScrollLeft(page, 0)

    await expect.poll(async () => {
      const metrics = await getCarouselMetrics(page)

      return metrics.scrollLeft > 0
        && metrics.scrollCalls > metricsBeforeManualReset.scrollCalls
    }, { timeout: 15_000 }).toBe(true)
  })

  test('reveals the detach-all control after the final upload completes', async ({
    page,
  }) => {
    await openUploadModal(page)
    await expect(page.getByTestId('files-upload-input')).toBeAttached({
      timeout: 15_000,
    })

    await page.getByTestId('files-upload-input').setInputFiles(makeFiles(10))

    await expect.poll(async () => {
      const metrics = await getCarouselMetrics(page)

      return !metrics.activeUploadingName
        && metrics.removeAllVisible
        && metrics.scrollLeft > 0
    }, { timeout: 15_000 }).toBe(true)
  })
})
