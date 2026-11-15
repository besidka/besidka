import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import Permissions from '../../../../../app/components/Profile/BesidkaTools/Permissions.vue'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  error: vi.fn(),
  refresh: vi.fn(),
}))

interface ToolRow {
  name: string
  title: string
  tier: 'read' | 'write' | 'ask-every-time'
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

function row(
  name: string,
  tier: ToolRow['tier'],
  mode: ToolRow['mode'] = 'ask',
): ToolRow {
  return { name, title: name.replace(/_/g, ' '), tier, mode }
}

function seedTools(overrides: Partial<Record<string, ToolRow['mode']>> = {}) {
  const base = [
    row('list_files', 'read'),
    row('get_project', 'read'),
    row('create_file', 'write'),
    row('delete_files', 'ask-every-time'),
  ]

  tools.value = {
    tools: base.map((tool) => {
      return { ...tool, mode: overrides[tool.name] ?? tool.mode }
    }),
  }
}

async function selectValue(
  wrapper: Awaited<ReturnType<typeof mountSuspended>>,
  testId: string,
  value: string,
) {
  const select = wrapper.get(`[data-testid="${testId}"]`)

  await select.setValue(value)
  await flushPromises()
}

enableAutoUnmount(afterEach)

describe('Profile/BesidkaTools/Permissions', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.error.mockReset()
    mocks.refresh.mockReset()
    status.value = 'success'
    fetchError.value = null
    seedTools()
  })

  it('shows the three groups with plain tool titles and group selects',
    async () => {
      const wrapper = await mountSuspended(Permissions)

      for (const tier of ['read', 'write', 'ask-every-time']) {
        expect(wrapper.find(`[data-testid="besidka-tool-group-${tier}"]`)
          .exists()).toBe(true)
      }

      expect(wrapper.get('[data-testid="besidka-tool-group-read"]').text())
        .toContain('Read-only')
      expect(wrapper.get('[data-testid="besidka-tool-group-write"]').text())
        .toContain('Write')
      expect(wrapper.get(
        '[data-testid="besidka-tool-group-ask-every-time"]',
      ).text()).toContain('Ask every time')
      expect(wrapper.get('[data-testid="besidka-tool-row-list_files"]').text())
        .toContain('list files')
    })

  it('offers Always allow in Read-only and Write but not Ask every time',
    async () => {
      const wrapper = await mountSuspended(Permissions)
      const optionsOf = (testId: string) => {
        return wrapper.get(`[data-testid="${testId}"]`)
          .findAll('option')
          .map(option => option.text())
      }

      expect(optionsOf('besidka-tool-group-select-read'))
        .toEqual(['Blocked', 'Needs approval', 'Always allow'])
      expect(optionsOf('besidka-tool-select-create_file'))
        .toEqual(['Blocked', 'Needs approval', 'Always allow'])
      expect(optionsOf('besidka-tool-group-select-ask-every-time'))
        .toEqual(['Blocked', 'Needs approval'])
      expect(optionsOf('besidka-tool-select-delete_files'))
        .toEqual(['Blocked', 'Needs approval'])
    })

  it('shows the shared mode of a group, and Custom when it is mixed',
    async () => {
      seedTools({ list_files: 'allow' })

      const wrapper = await mountSuspended(Permissions)
      const readSelect = wrapper
        .get('[data-testid="besidka-tool-group-select-read"]')

      expect((readSelect.element as HTMLSelectElement).value).toBe('custom')
      expect(readSelect.findAll('option').map(option => option.text()))
        .toContain('Custom')
      expect((wrapper.get(
        '[data-testid="besidka-tool-group-select-write"]',
      ).element as HTMLSelectElement).value).toBe('ask')
      expect(wrapper.get('[data-testid="besidka-tool-group-select-write"]')
        .findAll('option').map(option => option.text()))
        .not.toContain('Custom')
    })

  it('saves a group change at once and takes the stored list', async () => {
    mocks.fetch.mockResolvedValue({
      tools: [
        row('list_files', 'read', 'allow'),
        row('get_project', 'read', 'allow'),
        row('create_file', 'write'),
        row('delete_files', 'ask-every-time'),
      ],
    })

    const wrapper = await mountSuspended(Permissions)

    await selectValue(wrapper, 'besidka-tool-group-select-read', 'allow')

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/besidka-tools/permissions',
      { method: 'PUT', body: { tier: 'read', mode: 'allow' } },
    )
    expect((wrapper.get('[data-testid="besidka-tool-select-get_project"]')
      .element as HTMLSelectElement).value).toBe('allow')
  })

  it('saves one tool and turns its group to Custom', async () => {
    mocks.fetch.mockResolvedValue({
      tools: [
        row('list_files', 'read', 'blocked'),
        row('get_project', 'read'),
        row('create_file', 'write'),
        row('delete_files', 'ask-every-time'),
      ],
    })

    const wrapper = await mountSuspended(Permissions)

    await selectValue(wrapper, 'besidka-tool-select-list_files', 'blocked')

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/besidka-tools/permissions',
      { method: 'PUT', body: { tool: 'list_files', mode: 'blocked' } },
    )
    expect((wrapper.get('[data-testid="besidka-tool-group-select-read"]')
      .element as HTMLSelectElement).value).toBe('custom')
  })

  it('shows the change before the server answers', async () => {
    let finish: (value: unknown) => void = () => {}

    mocks.fetch.mockReturnValue(new Promise((resolve) => {
      finish = resolve
    }))

    const wrapper = await mountSuspended(Permissions)

    await wrapper.get('[data-testid="besidka-tool-select-create_file"]')
      .setValue('blocked')

    expect((wrapper.get('[data-testid="besidka-tool-group-select-write"]')
      .element as HTMLSelectElement).value).toBe('blocked')

    finish({
      tools: [
        row('list_files', 'read'),
        row('get_project', 'read'),
        row('create_file', 'write', 'blocked'),
        row('delete_files', 'ask-every-time'),
      ],
    })
    await flushPromises()
  })

  it('reverts and reports the error when saving fails', async () => {
    mocks.fetch.mockRejectedValue(Object.assign(new Error('Too many'), {
      data: { message: 'Too many permission changes', why: 'Slow down' },
    }))

    const wrapper = await mountSuspended(Permissions)

    await selectValue(wrapper, 'besidka-tool-select-create_file', 'blocked')

    expect(mocks.error).toHaveBeenCalledTimes(1)
    expect(mocks.error.mock.calls[0]![0]).toEqual(expect.any(String))
    expect((wrapper.get('[data-testid="besidka-tool-select-create_file"]')
      .element as HTMLSelectElement).value).toBe('ask')
  })

  it('shows an error with Retry when the list does not load', async () => {
    tools.value = null
    fetchError.value = new Error('offline')

    const wrapper = await mountSuspended(Permissions)

    expect(wrapper.find('[data-testid="besidka-tool-permissions-error"]')
      .exists()).toBe(true)

    await wrapper.get('[data-testid="besidka-tool-permissions-retry"]')
      .trigger('click')

    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })
})
