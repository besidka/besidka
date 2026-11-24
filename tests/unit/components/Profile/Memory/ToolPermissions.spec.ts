import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import ToolPermissions from '../../../../../app/components/Profile/Memory/ToolPermissions.vue'

import { MEMORY_TOOL_ALWAYS_ALLOW_WARNING } from '../../../../../shared/utils/memory-tool-permissions'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  error: vi.fn(),
  refresh: vi.fn(),
}))

interface ToolRow {
  name: 'memory_write' | 'memory_forget'
  title: string
  mode: 'blocked' | 'ask' | 'allow'
}

const tools = ref<{ tools: ToolRow[] } | null>(null)
const status = ref<string>('success')
const fetchError = ref<unknown>(null)

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useErrorMessage', () => mocks.error)
mockNuxtImport('useLazyFetch', () => {
  return () => ({
    data: tools,
    status,
    error: fetchError,
    refresh: mocks.refresh,
  })
})

function seedTools(overrides: Partial<Record<ToolRow['name'], ToolRow['mode']>>
  = {}) {
  tools.value = {
    tools: [
      {
        name: 'memory_write',
        title: 'Save to memory',
        mode: overrides.memory_write ?? 'ask',
      },
      {
        name: 'memory_forget',
        title: 'Forget from memory',
        mode: overrides.memory_forget ?? 'ask',
      },
    ],
  }
}

type Wrapper = Awaited<ReturnType<typeof mountSuspended>>

function toolRow(wrapper: Wrapper, name: string) {
  return wrapper.get(
    `[data-testid="memory-tool-permissions-row"][data-tool-name="${name}"]`,
  )
}

function checkedMode(wrapper: Wrapper, name: string) {
  return toolRow(wrapper, name)
    .get('[role="radio"][aria-checked="true"]')
    .attributes('data-mode')
}

async function chooseMode(wrapper: Wrapper, name: string, mode: string) {
  await toolRow(wrapper, name)
    .get(`[data-testid="tool-permission-option-${mode}"]`)
    .trigger('click')
  await flushPromises()
}

enableAutoUnmount(afterEach)

describe('Profile/Memory/ToolPermissions', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.error.mockReset()
    mocks.refresh.mockReset()
    status.value = 'success'
    fetchError.value = null
    seedTools()
  })

  it('shows one row per write tool with the three modes and the read note',
    async () => {
      const wrapper = await mountSuspended(ToolPermissions)

      expect(wrapper.text()).toContain('Saving to memory')
      expect(toolRow(wrapper, 'memory_write').text())
        .toContain('Save to memory')
      expect(toolRow(wrapper, 'memory_forget').text())
        .toContain('Forget from memory')
      expect(wrapper.findAll('[data-testid="memory-tool-permissions-row"]'))
        .toHaveLength(2)
      expect(toolRow(wrapper, 'memory_write')
        .findAll('[role="radio"]')
        .map(option => option.attributes('data-mode')).sort())
        .toEqual(['allow', 'ask', 'blocked'])
      expect(toolRow(wrapper, 'memory_forget')
        .findAll('[role="radio"]')
        .map(option => option.attributes('data-mode')).sort())
        .toEqual(['ask', 'blocked'])
      expect(checkedMode(wrapper, 'memory_write')).toBe('ask')
      expect(wrapper.get('[data-testid="memory-tool-permissions-read-note"]')
        .text()).toBe('Reading memory never asks.')
    })

  it('always shows the warning under the memory_write control, whatever the '
    + 'mode', async () => {
    const wrapper = await mountSuspended(ToolPermissions)
    const warning = toolRow(wrapper, 'memory_write')
      .get('[data-testid="memory-tool-permissions-warning"]')

    expect(warning.text()).toBe(MEMORY_TOOL_ALWAYS_ALLOW_WARNING)
    expect(warning.text()).toContain('save, overwrite and merge into your '
      + 'memory without asking')
    expect(warning.text()).toContain('even if you did not ask for a save')
    expect(warning.text()).toContain('The sensitive-topic check and the '
      + 'never-store list still run on every save.')
    expect(wrapper.findAll('[data-testid="memory-tool-permissions-warning"]'))
      .toHaveLength(1)

    seedTools({ memory_write: 'allow' })
    await flushPromises()

    expect(toolRow(wrapper, 'memory_write')
      .find('[data-testid="memory-tool-permissions-warning"]').exists())
      .toBe(true)
  })

  it('says forgetting always asks after web or file content', async () => {
    const wrapper = await mountSuspended(ToolPermissions)

    expect(toolRow(wrapper, 'memory_forget')
      .get('[data-testid="memory-tool-permissions-forget-note"]').text())
      .toBe('Forgetting always asks after web or file content, because it '
        + 'cannot be undone.')
    expect(toolRow(wrapper, 'memory_write')
      .find('[data-testid="memory-tool-permissions-forget-note"]').exists())
      .toBe(false)
  })

  it('announces when saving runs without asking, in a status region',
    async () => {
      const wrapper = await mountSuspended(ToolPermissions)
      const status = wrapper.get('[data-testid="memory-tool-permissions-status"]')

      expect(status.attributes('role')).toBe('status')
      expect(status.text()).toBe('')

      seedTools({ memory_write: 'allow' })
      await flushPromises()

      expect(status.text()).toBe('Saving to memory now runs without asking.')
    })

  it('saves one tool and takes the stored list', async () => {
    mocks.fetch.mockResolvedValue({
      tools: [
        { name: 'memory_write', title: 'Save to memory', mode: 'allow' },
        { name: 'memory_forget', title: 'Forget from memory', mode: 'ask' },
      ],
    })

    const wrapper = await mountSuspended(ToolPermissions)

    await chooseMode(wrapper, 'memory_write', 'allow')

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/memory/tool-permissions',
      { method: 'PUT', body: { tool: 'memory_write', mode: 'allow' } },
    )
    expect(checkedMode(wrapper, 'memory_write')).toBe('allow')
    expect(checkedMode(wrapper, 'memory_forget')).toBe('ask')
  })

  it('shows the change before the server answers', async () => {
    let finish: (value: unknown) => void = () => {}

    mocks.fetch.mockReturnValue(new Promise((resolve) => {
      finish = resolve
    }))

    const wrapper = await mountSuspended(ToolPermissions)

    await toolRow(wrapper, 'memory_forget')
      .get('[data-testid="tool-permission-option-blocked"]')
      .trigger('click')

    expect(checkedMode(wrapper, 'memory_forget')).toBe('blocked')

    finish({
      tools: [
        { name: 'memory_write', title: 'Save to memory', mode: 'ask' },
        { name: 'memory_forget', title: 'Forget from memory', mode: 'blocked' },
      ],
    })
    await flushPromises()
  })

  it('reverts and reports the error when saving fails', async () => {
    mocks.fetch.mockRejectedValue(Object.assign(new Error('Too many'), {
      data: { message: 'Too many permission changes', why: 'Slow down' },
    }))

    const wrapper = await mountSuspended(ToolPermissions)

    await chooseMode(wrapper, 'memory_write', 'allow')

    expect(mocks.error).toHaveBeenCalledTimes(1)
    expect(mocks.error.mock.calls[0]![0]).toEqual(expect.any(String))
    expect(checkedMode(wrapper, 'memory_write')).toBe('ask')
  })

  it('shows an error with Retry when the list does not load', async () => {
    tools.value = null
    fetchError.value = new Error('offline')

    const wrapper = await mountSuspended(ToolPermissions)

    expect(wrapper.find('[data-testid="memory-tool-permissions-error"]')
      .exists()).toBe(true)

    await wrapper.get('[data-testid="memory-tool-permissions-retry"]')
      .trigger('click')

    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })
})
