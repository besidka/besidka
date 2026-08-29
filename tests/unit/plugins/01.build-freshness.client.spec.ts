import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import plugin, {
  reloadWhenBuildIsOutdated,
} from '../../../app/plugins/01.build-freshness.client'

const mocks = vi.hoisted(() => ({
  currentBuildId: 'build-1',
  fetch: vi.fn(),
  reloadNuxtApp: vi.fn(),
  getAppManifest: vi.fn(),
  buildAssetsURL: vi.fn((path: string) => `/_nuxt/${path}`),
}))

mockNuxtImport('useRuntimeConfig', () => {
  return () => ({ app: { baseURL: '/', buildId: mocks.currentBuildId } })
})

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('reloadNuxtApp', () => mocks.reloadNuxtApp)
mockNuxtImport('getAppManifest', () => mocks.getAppManifest)

vi.mock('#internal/nuxt/paths', () => ({
  buildAssetsURL: mocks.buildAssetsURL,
}))

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function install() {
  ;(plugin as unknown as { setup: () => void }).setup()
}

describe('build freshness plugin', () => {
  beforeEach(() => {
    mocks.currentBuildId = 'build-1'
    mocks.fetch.mockReset()
    mocks.reloadNuxtApp.mockReset()
    mocks.getAppManifest.mockReset()
    mocks.buildAssetsURL.mockClear()
  })

  it('does not run under vitest, where import.meta.test is true',
    async () => {
      mocks.fetch.mockResolvedValue({ id: 'build-2', timestamp: 2 })

      install()
      await flushPromises()

      expect(mocks.fetch).not.toHaveBeenCalled()
      expect(mocks.reloadNuxtApp).not.toHaveBeenCalled()
    })

  describe('reloadWhenBuildIsOutdated', () => {
    it('does not reload when the latest build id matches the current one',
      async () => {
        mocks.fetch.mockResolvedValue({ id: 'build-1', timestamp: 1 })

        await reloadWhenBuildIsOutdated('build-1')

        expect(mocks.getAppManifest).not.toHaveBeenCalled()
        expect(mocks.reloadNuxtApp).not.toHaveBeenCalled()
      })

    it('does not reload when the latest manifest has no id', async () => {
      mocks.fetch.mockResolvedValue({})

      await reloadWhenBuildIsOutdated('build-1')

      expect(mocks.getAppManifest).not.toHaveBeenCalled()
      expect(mocks.reloadNuxtApp).not.toHaveBeenCalled()
    })

    it('does not reload or fetch meta when the latest is a stale edge '
      + 'copy with an older or equal timestamp', async () => {
      mocks.fetch.mockResolvedValueOnce({ id: 'build-2', timestamp: 1000 })
      mocks.getAppManifest.mockResolvedValue({
        id: 'build-1',
        timestamp: 2000,
        prerendered: [],
      })

      await reloadWhenBuildIsOutdated('build-1')

      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      expect(mocks.reloadNuxtApp).not.toHaveBeenCalled()
    })

    it('reloads once when the latest build is newer than the current one',
      async () => {
        mocks.fetch.mockResolvedValueOnce({ id: 'build-2', timestamp: 5000 })
        mocks.fetch.mockResolvedValueOnce({ id: 'build-2' })
        mocks.getAppManifest.mockResolvedValue({
          id: 'build-1',
          timestamp: 1000,
          prerendered: [],
        })

        await reloadWhenBuildIsOutdated('build-1')

        expect(mocks.reloadNuxtApp).toHaveBeenCalledTimes(1)
        expect(mocks.fetch.mock.calls[1][0]).toContain(
          'builds/meta/build-2.json',
        )
      })

    it('reloads when getAppManifest rejects, falling back to an '
      + 'id-only comparison', async () => {
      mocks.fetch.mockResolvedValueOnce({ id: 'build-2', timestamp: 5000 })
      mocks.fetch.mockResolvedValueOnce({ id: 'build-2' })
      mocks.getAppManifest.mockRejectedValue(new Error('gone'))

      await reloadWhenBuildIsOutdated('build-1')

      expect(mocks.reloadNuxtApp).toHaveBeenCalledTimes(1)
    })

    it('does not reload when the latest.json fetch rejects', async () => {
      mocks.fetch.mockRejectedValue(new Error('network error'))

      await reloadWhenBuildIsOutdated('build-1')

      expect(mocks.reloadNuxtApp).not.toHaveBeenCalled()
    })

    it('does not reload when the newer build meta file is missing',
      async () => {
        mocks.fetch.mockResolvedValueOnce({ id: 'build-2', timestamp: 5000 })
        mocks.fetch.mockRejectedValueOnce(new Error('404'))
        mocks.getAppManifest.mockResolvedValue({
          id: 'build-1',
          timestamp: 1000,
          prerendered: [],
        })

        await reloadWhenBuildIsOutdated('build-1')

        expect(mocks.reloadNuxtApp).not.toHaveBeenCalled()
      })
  })
})
