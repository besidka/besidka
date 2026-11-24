import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  error: vi.fn(),
}))

interface Row {
  name: 'memory_write' | 'memory_forget'
  title: string
  mode: 'blocked' | 'ask' | 'allow'
}

const data = ref<{ tools: Row[] } | null>(null)

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useErrorMessage', () => mocks.error)
mockNuxtImport('useLazyFetch', () => {
  return () => ({
    data,
    status: ref('success'),
    error: ref(null),
    refresh: vi.fn(),
  })
})

function seed() {
  data.value = {
    tools: [
      { name: 'memory_write', title: 'Save to memory', mode: 'ask' },
      { name: 'memory_forget', title: 'Forget from memory', mode: 'ask' },
    ],
  }
}

describe('useMemoryToolPermissions', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.error.mockReset()
    seed()
  })

  it('exposes the stored modes', () => {
    const { tools, isSaving } = useMemoryToolPermissions()

    expect(tools.value.map(tool => [tool.name, tool.mode])).toEqual([
      ['memory_write', 'ask'],
      ['memory_forget', 'ask'],
    ])
    expect(isSaving.value).toBe(false)
  })

  it('applies the mode at once and then takes the stored list', async () => {
    let finish: (value: unknown) => void = () => {}

    mocks.fetch.mockReturnValue(new Promise((resolve) => {
      finish = resolve
    }))

    const { tools, isSaving, save } = useMemoryToolPermissions()
    const saving = save('memory_write', 'allow')

    expect(tools.value[0]!.mode).toBe('allow')
    expect(isSaving.value).toBe(true)

    finish({
      tools: [
        { name: 'memory_write', title: 'Save to memory', mode: 'allow' },
        { name: 'memory_forget', title: 'Forget from memory', mode: 'blocked' },
      ],
    })
    await saving

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/memory/tool-permissions',
      { method: 'PUT', body: { tool: 'memory_write', mode: 'allow' } },
    )
    expect(tools.value.map(tool => tool.mode)).toEqual(['allow', 'blocked'])
    expect(isSaving.value).toBe(false)
  })

  it('drops the optimistic mode and reports the error on a failure',
    async () => {
      mocks.fetch.mockRejectedValue(Object.assign(new Error('nope'), {
        data: { message: 'Too many permission changes', why: 'Slow down' },
      }))

      const { tools, save } = useMemoryToolPermissions()

      await save('memory_forget', 'blocked')

      expect(tools.value[1]!.mode).toBe('ask')
      expect(mocks.error).toHaveBeenCalledWith(
        'Too many permission changes',
        'Slow down',
      )
    })

  it('runs saves one after another, so an older answer never replaces a '
    + 'newer one', async () => {
    const finishers: Array<(value: unknown) => void> = []

    mocks.fetch.mockImplementation(() => {
      return new Promise((resolve) => {
        finishers.push(resolve)
      })
    })

    const { tools, isSaving, save } = useMemoryToolPermissions()
    const first = save('memory_write', 'allow')
    const second = save('memory_write', 'blocked')

    expect(tools.value[0]!.mode).toBe('blocked')

    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1))
    await Promise.resolve()

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(isSaving.value).toBe(true)

    finishers[0]!({
      tools: [
        { name: 'memory_write', title: 'Save to memory', mode: 'allow' },
        { name: 'memory_forget', title: 'Forget from memory', mode: 'ask' },
      ],
    })
    await first
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2))

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/memory/tool-permissions',
      { method: 'PUT', body: { tool: 'memory_write', mode: 'blocked' } },
    )
    expect(tools.value[0]!.mode).toBe('blocked')

    finishers[1]!({
      tools: [
        { name: 'memory_write', title: 'Save to memory', mode: 'blocked' },
        { name: 'memory_forget', title: 'Forget from memory', mode: 'ask' },
      ],
    })
    await second

    expect(tools.value[0]!.mode).toBe('blocked')
    expect(isSaving.value).toBe(false)
  })

  it('keeps going after a failed save', async () => {
    mocks.fetch
      .mockRejectedValueOnce(new Error('nope'))
      .mockResolvedValueOnce({
        tools: [
          { name: 'memory_write', title: 'Save to memory', mode: 'ask' },
          { name: 'memory_forget', title: 'Forget from memory', mode: 'blocked' },
        ],
      })

    const { tools, save } = useMemoryToolPermissions()

    await Promise.all([
      save('memory_write', 'allow'),
      save('memory_forget', 'blocked'),
    ])

    expect(mocks.error).toHaveBeenCalledTimes(1)
    expect(tools.value.map(tool => tool.mode)).toEqual(['ask', 'blocked'])
  })
})
