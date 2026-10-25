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

    const outcome = save({ aboutMe: '  I like short answers  ' })

    await flushPromises()
    requestAt(0).resolve({
      aboutMe: 'I like short answers',
      sensitiveEntriesDeleted: 2,
      reasoningExpanded: true,
    })

    const result = await outcome

    expect(values.value.aboutMe).toBe('I like short answers')
    expect(values.value).not.toHaveProperty('sensitiveEntriesDeleted')
    expect(values.value).not.toHaveProperty('reasoningExpanded')
    expect(result).toEqual({
      ok: true,
      result: {
        aboutMe: 'I like short answers',
        sensitiveEntriesDeleted: 2,
        reasoningExpanded: true,
      },
    })
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
      const { values, save } = createSaver({ aboutMe: 'Persisted' })

      const first = save({ aboutMe: 'First draft' })
      const second = save({ aboutMe: 'Second draft' })

      expect(values.value.aboutMe).toBe('Second draft')

      await flushPromises()
      requestAt(0).reject({ statusCode: 500, message: 'Could not save' })
      await first
      await flushPromises()

      expect(values.value.aboutMe).toBe('Second draft')

      requestAt(1).reject({ statusCode: 500, message: 'Could not save' })
      await second

      expect(values.value.aboutMe).toBe('Persisted')
    })

  it('rolls back to the last confirmed value when a later save fails',
    async () => {
      const { values, save } = createSaver({ aboutMe: 'Persisted' })

      const first = save({ aboutMe: 'Confirmed' })
      const second = save({ aboutMe: 'Rejected' })

      await flushPromises()
      requestAt(0).resolve({ aboutMe: 'Confirmed' })
      await first
      await flushPromises()

      expect(values.value.aboutMe).toBe('Rejected')

      requestAt(1).reject({ statusCode: 400, message: 'Not allowed' })
      await second

      expect(values.value.aboutMe).toBe('Confirmed')
    })

  it('does not let a stale response overwrite a newer optimistic value',
    async () => {
      const { values, save } = createSaver()

      const first = save({ aboutMe: 'older' })
      const second = save({ aboutMe: 'newer' })

      await flushPromises()
      requestAt(0).resolve({ aboutMe: 'older' })
      await first

      expect(values.value.aboutMe).toBe('newer')

      await flushPromises()
      requestAt(1).resolve({ aboutMe: 'newer' })
      await second

      expect(values.value.aboutMe).toBe('newer')
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
