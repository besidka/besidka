import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import RegistrySearch from '../../../../../app/components/Profile/Connectors/RegistrySearch.client.vue'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}))

const isAdmin = ref<boolean>(false)

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useIsAdmin', () => () => isAdmin)

function item(index: number, patch: Record<string, unknown> = {}) {
  return {
    id: `io.example/tool-${index}@1.0.0`,
    name: `io.example/tool-${index}`,
    title: `Tool ${index}`,
    description: `Does thing ${index}`,
    remoteUrl: `https://mcp.tool${index}.example/mcp`,
    transport: 'streamable-http',
    authHint: 'unknown',
    presetId: null,
    publisher: 'example.com',
    isAdded: false,
    ...patch,
  }
}

function page(
  items: unknown[],
  patch: Record<string, unknown> = {},
) {
  return { items, nextCursor: null, total: items.length, ...patch }
}

function mountSearch(addedPresetIds: string[] = []) {
  return mountSuspended(RegistrySearch, {
    props: { addedPresetIds: new Set(addedPresetIds) },
    attachTo: document.body,
  })
}

function byId(id: string): HTMLElement | null {
  return document.body.querySelector(`[data-testid="${id}"]`)
}

function all(id: string): HTMLElement[] {
  return Array.from(document.body.querySelectorAll(`[data-testid="${id}"]`))
}

async function typeQuery(value: string) {
  const input = byId('connector-registry-query') as HTMLInputElement

  input.value = value
  input.dispatchEvent(new Event('input'))
  await new Promise(resolve => setTimeout(resolve, 350))
  await flushPromises()
}

describe('Profile/Connectors/RegistrySearch', () => {
  beforeEach(() => {
    isAdmin.value = false
    mocks.fetch.mockReset()
  })

  it('browses on open: Featured row, the total and cards with a registry icon',
    async () => {
      mocks.fetch.mockResolvedValue(page([item(1), item(2)], { total: 11050 }))

      await mountSearch(['notion'])
      await flushPromises()

      expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/connectors/registry', {
        query: {},
      })
      expect(byId('connector-add-presets')?.textContent).toContain('Atlassian')
      expect((byId('connector-preset-add-notion') as HTMLButtonElement).disabled)
        .toBe(true)
      expect(byId('connector-registry-total')?.textContent?.trim())
        .toBe('11050')

      const cards = all('connector-registry-item')

      expect(cards).toHaveLength(2)
      expect(cards[0]?.textContent).toContain('Tool 1')
      expect(cards[0]?.textContent).toContain('by example.com')
      expect(cards[0]?.textContent).toContain('mcp.tool1.example')
      expect(cards[0]?.textContent).toContain('Sign in or token')
      expect(cards[0]?.querySelector('img')?.getAttribute('src'))
        .toBe('/api/v1/connectors/registry/icon?id='
          + 'io.example%2Ftool-1%401.0.0')
      expect(byId('connector-registry')?.textContent)
        .toContain('Not reviewed by Besidka')
    })

  it('says what a header entry needs and marks added entries', async () => {
    mocks.fetch.mockResolvedValue(page([
      item(1, { authHint: 'header' }),
      item(2, { isAdded: true }),
      item(3, { presetId: 'github' }),
    ]))

    await mountSearch(['github'])
    await flushPromises()

    const buttons = all('connector-registry-add') as HTMLButtonElement[]

    expect(all('connector-registry-item')[0]?.textContent)
      .toContain('API key or token')
    expect(buttons.map(button => button.textContent?.trim()))
      .toEqual(['Add', 'Added', 'Added'])
    expect(buttons.map(button => button.disabled))
      .toEqual([false, true, true])
  })

  it('searches after a pause, hides Featured and shows Results', async () => {
    mocks.fetch.mockResolvedValue(page([item(1)]))

    await mountSearch()
    await flushPromises()
    mocks.fetch.mockClear()
    await typeQuery('tool')

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/connectors/registry', {
      query: { q: 'tool' },
    })
    expect(byId('connector-add-presets')).toBeNull()
    expect(document.body.textContent).toContain('Results')
  })

  it('keeps browsing for a single character instead of asking the server',
    async () => {
      mocks.fetch.mockResolvedValue(page([item(1)]))

      await mountSearch()
      await flushPromises()
      mocks.fetch.mockClear()
      await typeQuery('t')

      expect(mocks.fetch).not.toHaveBeenCalled()
      expect(byId('connector-add-presets')).not.toBeNull()
    })

  it('shows more with the cursor and appends the next page', async () => {
    mocks.fetch.mockImplementation(async (_url: string, options: {
      query: { cursor?: number }
    }) => {
      return options.query.cursor
        ? page([item(21)], { nextCursor: null, total: 21 })
        : page([item(1)], { nextCursor: 20, total: 21 })
    })

    await mountSearch()
    await flushPromises()
    ;(byId('connector-registry-more') as HTMLButtonElement).click()
    await flushPromises()

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/connectors/registry',
      { query: { cursor: 20 } },
    )
    expect(all('connector-registry-item')).toHaveLength(2)
    expect(byId('connector-registry-more')).toBeNull()
    expect(byId('connector-registry-total')?.textContent?.trim()).toBe('21')
  })

  it('says so when the last page is capped before the total is shown',
    async () => {
      mocks.fetch.mockResolvedValue(
        page([item(1), item(2)], { nextCursor: null, total: 12000 }),
      )

      await mountSearch()
      await flushPromises()

      expect(byId('connector-registry-truncated')?.textContent)
        .toContain('Showing the first 2. Search to find the rest.')
      expect(byId('connector-registry-more')).toBeNull()
    })

  it('does not say it when everything is shown', async () => {
    mocks.fetch.mockResolvedValue(page([item(1)], { total: 1 }))

    await mountSearch()
    await flushPromises()

    expect(byId('connector-registry-truncated')).toBeNull()
  })

  it('says the directory is being copied when the table is empty', async () => {
    mocks.fetch.mockResolvedValue(page([], { syncing: true, total: 0 }))

    await mountSearch()
    await flushPromises()

    expect(byId('connector-registry-syncing')).not.toBeNull()
    expect(byId('connector-registry-total')).toBeNull()
  })

  it('says nothing was found and shows a failure as an alert', async () => {
    mocks.fetch.mockResolvedValue(page([]))

    await mountSearch()
    await flushPromises()
    await typeQuery('zzzz')

    expect(byId('connector-registry-empty')).not.toBeNull()

    mocks.fetch.mockRejectedValue(Object.assign(new Error('Slow down'), {
      data: { message: 'Too many requests' },
      statusCode: 429,
    }))
    await typeQuery('tool')

    expect(byId('connector-registry-error')?.getAttribute('role'))
      .toBe('alert')
    expect(byId('connector-registry-error')?.textContent)
      .toContain('Too many requests')
  })

  it('ignores a slow answer that a newer search replaced', async () => {
    let releaseFirst: (value: unknown) => void = () => undefined

    mocks.fetch.mockResolvedValueOnce(page([]))
    await mountSearch()
    await flushPromises()
    mocks.fetch.mockReset()
    mocks.fetch
      .mockImplementationOnce(() => new Promise((resolve) => {
        releaseFirst = resolve
      }))
      .mockResolvedValueOnce(page([item(2)]))
    await typeQuery('first')
    await typeQuery('second')
    releaseFirst(page([item(1)]))
    await flushPromises()

    expect(all('connector-registry-item')).toHaveLength(1)
    expect(all('connector-registry-item')[0]?.textContent).toContain('Tool 2')
  })

  it('emits add and add-preset', async () => {
    mocks.fetch.mockResolvedValue(page([item(1)]))

    const wrapper = await mountSearch()

    await flushPromises()
    ;(byId('connector-registry-add') as HTMLButtonElement).click()
    ;(byId('connector-preset-add-github') as HTMLButtonElement).click()

    expect(wrapper.emitted('add')?.[0]?.[0]).toMatchObject({
      id: 'io.example/tool-1@1.0.0',
    })
    expect(wrapper.emitted('add-preset')?.[0]).toEqual(['github'])
  })

  describe('Sync now', () => {
    it('is hidden from a non-admin and never asks the admin route', async () => {
      mocks.fetch.mockResolvedValue(page([item(1)]))

      await mountSearch()
      await flushPromises()

      expect(byId('connector-registry-admin')).toBeNull()
      expect(byId('connector-registry-sync-now')).toBeNull()
      expect(mocks.fetch.mock.calls.map(call => call[0]))
        .not.toContain('/api/v1/admin/connectors/registry')
    })

    it('shows an admin the status and runs until the sync completes, then '
      + 'reloads the directory', async () => {
      const status = {
        rows: 0,
        lastSyncedAt: null,
        hasUnfinishedRun: false,
        isRunning: false,
      }
      let syncRuns = 0

      isAdmin.value = true
      mocks.fetch.mockImplementation(async (url: string) => {
        if (url === '/api/v1/admin/connectors/registry') {
          return status
        }

        if (url === '/api/v1/admin/connectors/registry/sync') {
          syncRuns += 1

          return {
            ...status,
            rows: syncRuns * 2000,
            outcome: syncRuns < 3 ? 'partial' : 'completed',
          }
        }

        return page([item(1)], { total: syncRuns * 2000 })
      })

      await mountSearch()
      await flushPromises()

      expect(byId('connector-registry-admin-status')?.textContent)
        .toContain('0 entries copied, never synced')

      ;(byId('connector-registry-sync-now') as HTMLButtonElement).click()
      await flushPromises()

      expect(syncRuns).toBe(3)
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/admin/connectors/registry/sync',
        { method: 'POST' },
      )
      expect(byId('connector-registry-total')?.textContent?.trim())
        .toBe('6000')
    })

    it('stops on a busy or failed answer and says why', async () => {
      isAdmin.value = true
      mocks.fetch.mockImplementation(async (url: string) => {
        if (url === '/api/v1/admin/connectors/registry/sync') {
          return {
            rows: 5,
            lastSyncedAt: null,
            hasUnfinishedRun: true,
            isRunning: true,
            outcome: 'busy',
          }
        }

        if (url === '/api/v1/admin/connectors/registry') {
          return { rows: 5, lastSyncedAt: null }
        }

        return page([item(1)])
      })

      await mountSearch()
      await flushPromises()
      ;(byId('connector-registry-sync-now') as HTMLButtonElement).click()
      await flushPromises()

      expect(byId('connector-registry-admin-status')?.textContent)
        .toContain('already running')
    })
  })
})
