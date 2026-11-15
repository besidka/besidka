import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ConnectorsRedirectPage from '../../../../app/pages/profile/connectors.vue'

const mocks = vi.hoisted(() => ({
  navigateTo: vi.fn(),
  query: {} as Record<string, unknown>,
}))

mockNuxtImport('navigateTo', () => mocks.navigateTo)
mockNuxtImport('useRoute', () => {
  return () => ({ path: '/profile/connectors', query: mocks.query })
})

describe('profile connectors redirect page', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    mocks.navigateTo.mockReset()
    mocks.query = {}
  })

  it('redirects permanently to the connectors page', async () => {
    await mountSuspended(ConnectorsRedirectPage)

    expect(mocks.navigateTo).toHaveBeenCalledWith(
      { path: '/chats/connectors', query: {} },
      { redirectCode: 301 },
    )
  })

  it('keeps the query string of OAuth callbacks and deep links', async () => {
    mocks.query = { connected: 'conn1', add: 'directory' }

    await mountSuspended(ConnectorsRedirectPage)

    expect(mocks.navigateTo).toHaveBeenCalledWith(
      {
        path: '/chats/connectors',
        query: { connected: 'conn1', add: 'directory' },
      },
      { redirectCode: 301 },
    )
  })
})
