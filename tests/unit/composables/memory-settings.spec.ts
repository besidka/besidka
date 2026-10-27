import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemorySettingsFields } from '../../../shared/types/memory.d'
import { useMemorySettingsSaver } from '../../../app/composables/memory-settings'

interface PendingRequest {
  body: Record<string, unknown>
  resolve: (response: Record<string, unknown>) => void
  reject: (error: Record<string, unknown>) => void
}

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  pending: [] as Array<PendingRequest>,
}))

mockNuxtImport('$fetch', () => mocks.fetch)

const defaultSettings: MemorySettingsFields = {
  memoryEnabled: true,
  memoryExtractionEnabled: false,
  chatSearchEnabled: true,
  memoryIncludeSensitive: false,
  aboutMe: null,
  profileMemoryModel: null,
  profileMemoryGateway: null,
  projectMemoryModel: null,
  projectMemoryGateway: null,
}

function createSaver(overrides: Partial<MemorySettingsFields> = {}) {
  const settings = ref<MemorySettingsFields | null>({
    ...defaultSettings,
    ...overrides,
  })

  return {
    settings,
    ...useMemorySettingsSaver(settings),
  }
}

function requestAt(index: number): PendingRequest {
  return mocks.pending[index]!
}

describe('useMemorySettingsSaver', () => {
  beforeEach(() => {
    mocks.pending.length = 0
    mocks.fetch.mockReset()
    mocks.fetch.mockImplementation((
      _url: string,
      options: { body: Record<string, unknown> },
    ) => {
      return new Promise((resolve, reject) => {
        mocks.pending.push({
          body: options.body,
          resolve,
          reject: (error) => {
            reject(Object.assign(new Error('Request failed'), {
              data: error,
            }))
          },
        })
      })
    })
  })

  it('exposes defaults when settings are not loaded', () => {
    const settings = ref<MemorySettingsFields | null>(null)
    const { values } = useMemorySettingsSaver(settings)

    expect(values.value.memoryEnabled)
      .toBe(MEMORY_SETTING_DEFAULTS.memoryEnabled)
    expect(values.value.memoryExtractionEnabled).toBe(false)
    expect(values.value.aboutMe).toBeNull()
    expect(values.value.profileMemoryModel).toBeNull()
  })

  it('shows the optimistic value before the request settles', async () => {
    const { values, save } = createSaver()

    const outcome = save({ chatSearchEnabled: false })

    expect(values.value.chatSearchEnabled).toBe(false)

    await flushPromises()

    expect(requestAt(0).body).toEqual({ chatSearchEnabled: false })

    requestAt(0).resolve({ chatSearchEnabled: false })

    await expect(outcome).resolves.toEqual({
      ok: true,
      result: { chatSearchEnabled: false },
    })
    expect(values.value.chatSearchEnabled).toBe(false)
  })

  it('rolls back only the patched keys when the request fails', async () => {
    const { settings, values, save } = createSaver()

    const outcome = save({ chatSearchEnabled: false })

    await flushPromises()

    settings.value = { ...values.value, aboutMe: 'Edited elsewhere' }
    requestAt(0).reject({ statusCode: 500, message: 'Could not save' })

    await outcome

    expect(values.value.chatSearchEnabled).toBe(true)
    expect(values.value.aboutMe).toBe('Edited elsewhere')
  })

  it('returns the parsed error when the request fails', async () => {
    const { save } = createSaver()

    const outcome = save({ memoryEnabled: false })

    await flushPromises()
    requestAt(0).reject({
      statusCode: 400,
      message: 'Could not save',
      data: { why: 'Database unavailable' },
    })

    const result = await outcome

    expect(result.ok).toBe(false)

    if (result.ok) {
      return
    }

    expect(result.parsed.message).toBe('Could not save')
    expect(result.parsed.why).toBe('Database unavailable')
  })

  it('merges the server response and ignores non-memory fields', async () => {
    const { values, save } = createSaver()

    const outcome = save({ profileMemoryModel: '  vendor/model-a  ' })

    await flushPromises()
    requestAt(0).resolve({
      profileMemoryModel: 'vendor/model-a',
      reasoningExpanded: true,
    })

    const result = await outcome

    expect(values.value.profileMemoryModel).toBe('vendor/model-a')
    expect(values.value).not.toHaveProperty('reasoningExpanded')
    expect(result).toEqual({
      ok: true,
      result: {
        profileMemoryModel: 'vendor/model-a',
        reasoningExpanded: true,
      },
    })
  })

  it('does not track aboutMe as a saver key', async () => {
    const { values, save } = createSaver({ aboutMe: 'Leftover text' })

    const outcome = save({ chatSearchEnabled: false })

    await flushPromises()
    requestAt(0).resolve({ chatSearchEnabled: false, aboutMe: null })
    await outcome

    expect(values.value.aboutMe).toBe('Leftover text')
  })

  it('sends exactly the given patch and never adds memoryIncludeSensitive',
    async () => {
      const { save } = createSaver()

      const outcome = save({ profileMemoryModel: 'vendor/model-b' })

      await flushPromises()

      expect(requestAt(0).body).toEqual({ profileMemoryModel: 'vendor/model-b' })
      expect(requestAt(0).body).not.toHaveProperty('memoryIncludeSensitive')

      requestAt(0).resolve({ profileMemoryModel: 'vendor/model-b' })
      await outcome

      const next = save({ memoryEnabled: false })

      await flushPromises()

      expect(requestAt(1).body).toEqual({ memoryEnabled: false })
      expect(requestAt(1).body).not.toHaveProperty('memoryIncludeSensitive')

      requestAt(1).resolve({ memoryEnabled: false })
      await next
    })

  it('serializes saves: the second request waits for the first',
    async () => {
      const { save } = createSaver()

      const first = save({ memoryEnabled: false })
      const second = save({ memoryEnabled: true })

      await flushPromises()

      expect(mocks.fetch).toHaveBeenCalledTimes(1)

      requestAt(0).resolve({ memoryEnabled: false })
      await first
      await flushPromises()

      expect(mocks.fetch).toHaveBeenCalledTimes(2)
      expect(requestAt(1).body).toEqual({ memoryEnabled: true })

      requestAt(1).resolve({ memoryEnabled: true })

      await expect(second).resolves.toEqual({
        ok: true,
        result: { memoryEnabled: true },
      })
    })

  it('starts the next save even when the previous one failed', async () => {
    const { save } = createSaver()

    const first = save({ memoryEnabled: false })
    const second = save({ chatSearchEnabled: false })

    await flushPromises()
    requestAt(0).reject({ statusCode: 500, message: 'Could not save' })

    expect((await first).ok).toBe(false)

    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledTimes(2)

    requestAt(1).resolve({ chatSearchEnabled: false })

    expect((await second).ok).toBe(true)
  })

  it('ends on the persisted value when both saves of a key fail',
    async () => {
      const { values, save } = createSaver({ profileMemoryModel: 'vendor/persisted' })

      const first = save({ profileMemoryModel: 'vendor/first' })
      const second = save({ profileMemoryModel: 'vendor/second' })

      expect(values.value.profileMemoryModel).toBe('vendor/second')

      await flushPromises()
      requestAt(0).reject({ statusCode: 500, message: 'Could not save' })
      await first
      await flushPromises()

      expect(values.value.profileMemoryModel).toBe('vendor/second')

      requestAt(1).reject({ statusCode: 500, message: 'Could not save' })
      await second

      expect(values.value.profileMemoryModel).toBe('vendor/persisted')
    })

  it('rolls back to the last confirmed value when a later save fails',
    async () => {
      const { values, save } = createSaver({ profileMemoryModel: 'vendor/persisted' })

      const first = save({ profileMemoryModel: 'vendor/confirmed' })
      const second = save({ profileMemoryModel: 'vendor/rejected' })

      await flushPromises()
      requestAt(0).resolve({ profileMemoryModel: 'vendor/confirmed' })
      await first
      await flushPromises()

      expect(values.value.profileMemoryModel).toBe('vendor/rejected')

      requestAt(1).reject({ statusCode: 400, message: 'Not allowed' })
      await second

      expect(values.value.profileMemoryModel).toBe('vendor/confirmed')
    })

  it('does not let a stale response overwrite a newer optimistic value',
    async () => {
      const { values, save } = createSaver()

      const first = save({ profileMemoryModel: 'vendor/older' })
      const second = save({ profileMemoryModel: 'vendor/newer' })

      await flushPromises()
      requestAt(0).resolve({ profileMemoryModel: 'vendor/older' })
      await first

      expect(values.value.profileMemoryModel).toBe('vendor/newer')

      await flushPromises()
      requestAt(1).resolve({ profileMemoryModel: 'vendor/newer' })
      await second

      expect(values.value.profileMemoryModel).toBe('vendor/newer')
    })

  it('keeps different keys independent', async () => {
    const { values, save } = createSaver()

    const first = save({ memoryEnabled: false })
    const second = save({ chatSearchEnabled: false })

    expect(values.value.memoryEnabled).toBe(false)
    expect(values.value.chatSearchEnabled).toBe(false)

    await flushPromises()
    requestAt(0).reject({ statusCode: 500, message: 'Could not save' })
    await first

    expect(values.value.memoryEnabled).toBe(true)
    expect(values.value.chatSearchEnabled).toBe(false)

    await flushPromises()
    requestAt(1).resolve({ chatSearchEnabled: false })
    await second

    expect(values.value.memoryEnabled).toBe(true)
    expect(values.value.chatSearchEnabled).toBe(false)
  })
})
