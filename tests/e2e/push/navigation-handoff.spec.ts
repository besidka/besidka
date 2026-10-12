import { test, expect, type Page } from '@playwright/test'

const PUSH_DATABASE_NAME = 'besidka-push'
const PENDING_STORE_NAME = 'pending-navigation'
const PENDING_KEY = 'latest'
const APP_FREE_DOCUMENT_PATH = '/ai.txt'

test.use({
  storageState: {
    cookies: [],
    origins: [],
  },
})

async function writePendingNavigation(page: Page, url: string) {
  await page.evaluate(({ databaseName, storeName, key, target }) => {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1)

      request.onupgradeneeded = () => {
        request.result.createObjectStore(storeName)
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction(storeName, 'readwrite')

        transaction.objectStore(storeName).put(
          { url: target, savedAt: Date.now() },
          key,
        )
        transaction.oncomplete = () => {
          database.close()
          resolve()
        }
        transaction.onerror = () => reject(transaction.error)
      }
    })
  }, {
    databaseName: PUSH_DATABASE_NAME,
    storeName: PENDING_STORE_NAME,
    key: PENDING_KEY,
    target: url,
  })
}

async function seedPendingNavigationOutsideApp(page: Page, url: string) {
  await page.goto(APP_FREE_DOCUMENT_PATH)
  await writePendingNavigation(page, url)
  await page.goto('/signin')
}

async function readPendingNavigation(page: Page) {
  return page.evaluate(({ databaseName, storeName, key }) => {
    return new Promise<unknown>((resolve) => {
      const request = indexedDB.open(databaseName)

      request.onerror = () => resolve(null)
      request.onsuccess = () => {
        const database = request.result

        if (!database.objectStoreNames.contains(storeName)) {
          database.close()
          resolve(null)

          return
        }

        const getRequest = database
          .transaction(storeName)
          .objectStore(storeName)
          .get(key)

        getRequest.onsuccess = () => {
          database.close()
          resolve(getRequest.result ?? null)
        }
        getRequest.onerror = () => {
          database.close()
          resolve(null)
        }
      }
    })
  }, {
    databaseName: PUSH_DATABASE_NAME,
    storeName: PENDING_STORE_NAME,
    key: PENDING_KEY,
  })
}

test.describe('Push cold-start handoff', () => {
  test.beforeEach(async ({ page, context, baseURL }) => {
    await context.grantPermissions(['notifications'], { origin: baseURL })
    await context.addInitScript(() => {
      Object.defineProperty(Notification, 'permission', {
        configurable: true,
        get: () => 'granted',
      })
    })
    await page.goto('/signin')
    await page.waitForLoadState('domcontentloaded')
  })

  test('the app navigates to a target the service worker persisted',
    async ({ page }) => {
      expect(await page.evaluate(() => Notification.permission))
        .toBe('granted')

      await seedPendingNavigationOutsideApp(page, '/privacy-policy')

      await expect(page).toHaveURL(/\/privacy-policy$/, { timeout: 8000 })

      await expect.poll(() => readPendingNavigation(page)).toBeNull()
    })

  test('the app ignores a persisted target that leaves the origin',
    async ({ page }) => {
      await seedPendingNavigationOutsideApp(page, '/\\evil.example.com')
      await page.waitForTimeout(3000)

      expect(new URL(page.url()).origin).toBe(new URL('/', page.url()).origin)
      expect(page.url()).toContain('/signin')
    })
})
