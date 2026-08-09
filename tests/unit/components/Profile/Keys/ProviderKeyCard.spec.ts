import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as messagesComposable from '../../../../../app/composables/messages'
import ProviderKeyCard
  from '../../../../../app/components/Profile/Keys/ProviderKeyCard.vue'

interface KeySummaryRow {
  provider: string
  hasKey: boolean
}

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  confirm: vi.fn(),
  summaryRows: [] as KeySummaryRow[],
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useConfirm', () => mocks.confirm)

async function flushPromises() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

function summaryFor(rows: KeySummaryRow[]) {
  mocks.summaryRows = rows
}

function apiKeyInput(wrapper: any) {
  return wrapper.find('[data-testid="api-key-field"] input')
}

function deleteButton(wrapper: any) {
  return wrapper.findAll('button').find((button: any) => {
    return button.text().includes('Delete')
  })
}

function dashboardLink(wrapper: any, host: string) {
  return wrapper.findAll('a').find((anchor: any) => {
    const target = anchor.attributes('href') ?? anchor.attributes('to') ?? ''

    return target.includes(host)
  })
}

async function mountCard(providerId: string) {
  const wrapper = await mountSuspended(ProviderKeyCard, {
    props: { providerId },
  })

  await flushPromises()

  return wrapper
}

describe('Profile/Keys/ProviderKeyCard', () => {
  beforeEach(() => {
    clearNuxtData()
    mocks.fetch.mockReset()
    mocks.confirm.mockReset()
    mocks.confirm.mockResolvedValue({ label: 'Confirm', index: 0 })
    mocks.summaryRows = []
    mocks.fetch.mockImplementation((url: string) => {
      if (url === '/api/v1/profiles/keys') {
        return Promise.resolve({ keys: mocks.summaryRows })
      }

      if (url.startsWith('/api/v1/profiles/keys/')) {
        return Promise.resolve({})
      }

      throw new Error(`Unexpected request: ${url}`)
    })
  })

  it('never requests the per-provider key route on mount', async () => {
    summaryFor([{ provider: 'anthropic', hasKey: true }])

    await mountCard('anthropic')

    const providerCalls = mocks.fetch.mock.calls.filter(([url]) => {
      return url === '/api/v1/profiles/keys/anthropic'
    })

    expect(providerCalls).toHaveLength(0)
  })

  it('leaves the input empty and badges a stored key as saved', async () => {
    summaryFor([{ provider: 'anthropic', hasKey: true }])

    const wrapper = await mountCard('anthropic')
    const input = apiKeyInput(wrapper).element as HTMLInputElement

    expect(input.value).toBe('')
    expect(input.placeholder).toBe('Enter a new key to replace the saved one')
    expect(wrapper.find('[data-testid="key-status-saved"]').exists()).toBe(true)
    expect(deleteButton(wrapper)).toBeDefined()
  })

  it('shows the provider-specific placeholder when no key is stored',
    async () => {
      summaryFor([{ provider: 'anthropic', hasKey: false }])

      const wrapper = await mountCard('anthropic')
      const input = apiKeyInput(wrapper).element as HTMLInputElement

      expect(input.placeholder).toBe('sk-ant-api03-xxxx...-xxxx...')
      expect(wrapper.find('[data-testid="key-status-missing"]').exists())
        .toBe(true)
      expect(deleteButton(wrapper)).toBeUndefined()
    })

  it('falls back to the shared placeholder for a provider without one',
    async () => {
      summaryFor([{ provider: 'deepseek', hasKey: false }])

      const wrapper = await mountCard('deepseek')

      expect((apiKeyInput(wrapper).element as HTMLInputElement).placeholder)
        .toBe('xxxx...')
    })

  it('offers no delete button while the key status is unknown', async () => {
    summaryFor([])

    const wrapper = await mountCard('anthropic')

    expect(deleteButton(wrapper)).toBeUndefined()
    expect(wrapper.find('[data-testid="key-status-saved"]').exists())
      .toBe(false)
  })

  it('resolves a gateway through its keys-table id, not its GatewayId',
    async () => {
      summaryFor([{ provider: 'vercel-gateway', hasKey: true }])

      const wrapper = await mountCard('vercel')

      expect(wrapper.find('[data-testid="key-status-saved"]').exists())
        .toBe(true)
      expect(wrapper.find('summary').text()).toContain('Vercel AI Gateway')
    })

  it('posts to the keys-table route and clears the input after saving',
    async () => {
      summaryFor([{ provider: 'openrouter', hasKey: false }])

      const useSuccessMessage
        = vi.spyOn(messagesComposable, 'useSuccessMessage')

      const wrapper = await mountCard('openrouter')

      await apiKeyInput(wrapper).setValue('sk-or-new-key')
      await wrapper.get('form').trigger('submit')

      await vi.waitFor(() => {
        expect(mocks.fetch).toHaveBeenCalledWith(
          '/api/v1/profiles/keys/openrouter',
          expect.objectContaining({
            method: 'post',
            body: { apiKey: 'sk-or-new-key' },
          }),
        )
        expect(useSuccessMessage).toHaveBeenCalledWith(
          'OpenRouter API key updated successfully',
        )
      })

      await flushPromises()

      expect((apiKeyInput(wrapper).element as HTMLInputElement).value).toBe('')
    })

  it('deletes the key behind a confirmation', async () => {
    summaryFor([{ provider: 'anthropic', hasKey: true }])

    const useSuccessMessage = vi.spyOn(messagesComposable, 'useSuccessMessage')

    const wrapper = await mountCard('anthropic')

    await deleteButton(wrapper)?.trigger('click')

    await vi.waitFor(() => {
      expect(mocks.confirm).toHaveBeenCalled()
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/profiles/keys/anthropic',
        expect.objectContaining({ method: 'delete' }),
      )
      expect(useSuccessMessage).toHaveBeenCalledWith(
        'Anthropic API key deleted successfully',
      )
    })
  })

  it('does not delete when the confirmation is declined', async () => {
    summaryFor([{ provider: 'anthropic', hasKey: true }])
    mocks.confirm.mockResolvedValue(null)

    const wrapper = await mountCard('anthropic')

    await deleteButton(wrapper)?.trigger('click')

    await vi.waitFor(() => {
      expect(mocks.confirm).toHaveBeenCalled()
    })

    const deleteCalls = mocks.fetch.mock.calls.filter(([, options]) => {
      return options?.method === 'delete'
    })

    expect(deleteCalls).toHaveLength(0)
  })

  it('underlines the provider dashboard link', async () => {
    summaryFor([{ provider: 'anthropic', hasKey: false }])

    const wrapper = await mountCard('anthropic')
    const link = dashboardLink(wrapper, 'platform.claude.com')

    expect(link).toBeDefined()
    expect(link?.classes()).toContain('link')
  })

  it('reads the dashboard link from provider metadata for every card',
    async () => {
      summaryFor([{ provider: 'moonshotai', hasKey: false }])

      const wrapper = await mountCard('moonshotai')
      const link = dashboardLink(wrapper, 'platform.kimi.ai')

      expect(link).toBeDefined()
      expect(link?.classes()).toContain('link')
      expect(link?.attributes('target')).toBe('_blank')
    })

  it('reads the dashboard link from provider metadata for the qwen card',
    async () => {
      summaryFor([{ provider: 'qwen', hasKey: false }])

      const wrapper = await mountCard('qwen')
      const link = dashboardLink(wrapper, 'bailian.console.alibabacloud.com')

      expect(link).toBeDefined()
      expect(link?.classes()).toContain('link')
      expect(link?.attributes('target')).toBe('_blank')
    })
})
