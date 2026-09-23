import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as messagesComposable from '../../../../../app/composables/messages'
import CloudflareGateway from '../../../../../app/components/Profile/Keys/CloudflareGateway.vue'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  confirm: vi.fn(async () => ({ label: 'Confirm', index: 0 })),
  paste: vi.fn(async () => ''),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('useClipboardWithPaste', () => {
  return () => ({ paste: mocks.paste })
})

async function flushPromises() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

function credentialResponse(overrides: Record<string, unknown> = {}) {
  return {
    accountId: '',
    gatewayId: '',
    hasKey: false,
    ...overrides,
  }
}

function accountIdInput(wrapper: any) {
  return wrapper.find('[data-testid="account-id-field"] input')
}

function gatewayIdInput(wrapper: any) {
  return wrapper.find('[data-testid="gateway-id-field"] input')
}

function apiKeyInput(wrapper: any) {
  return wrapper.find('[data-testid="api-key-field"] input')
}

function fieldPasteButton(wrapper: any, testId: string) {
  return wrapper.find(`[data-testid="${testId}"] button[aria-label="Paste"]`)
}

function deleteButton(wrapper: any) {
  return wrapper.findAll('button').find((button: any) => {
    return button.text().includes('Delete')
  })
}

describe('Profile/Keys/CloudflareGateway', () => {
  beforeEach(() => {
    clearNuxtData()
    mocks.fetch.mockReset()
    mocks.confirm.mockReset()
    mocks.confirm.mockResolvedValue({ label: 'Confirm', index: 0 })
    mocks.paste.mockReset()
    mocks.paste.mockResolvedValue('')
    mocks.fetch.mockImplementation((url: string) => {
      if (url === '/api/v1/profiles/keys/cloudflare-gateway') {
        return Promise.resolve(credentialResponse())
      }

      if (url === '/api/v1/profiles/keys') {
        return Promise.resolve({ keys: [] })
      }

      throw new Error(`Unexpected request: ${url}`)
    })
  })

  it('renders empty fields with no delete button when no credentials are stored',
    async () => {
      const wrapper = await mountSuspended(CloudflareGateway)

      await flushPromises()

      expect((accountIdInput(wrapper).element as HTMLInputElement).value)
        .toBe('')
      expect((gatewayIdInput(wrapper).element as HTMLInputElement).value)
        .toBe('')
      expect(deleteButton(wrapper)).toBeUndefined()
      expect(wrapper.find('[data-testid="key-status-saved"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="key-status-missing"]').exists())
        .toBe(true)
      expect((apiKeyInput(wrapper).element as HTMLInputElement).placeholder)
        .toBe('xxxx...')
    })

  it('renders a note explaining how the Gateway ID affects billing',
    async () => {
      const wrapper = await mountSuspended(CloudflareGateway)

      await flushPromises()

      const text = wrapper.text()

      expect(text).toContain('Gateway ID')
      expect(text).toContain('credits')
    })

  it('pre-fills accountId and gatewayId but never the API token',
    async () => {
      mocks.fetch.mockImplementation((url: string) => {
        if (url === '/api/v1/profiles/keys/cloudflare-gateway') {
          return Promise.resolve(credentialResponse({
            accountId: 'account-123',
            gatewayId: 'my-gateway',
            hasKey: true,
          }))
        }

        if (url === '/api/v1/profiles/keys') {
          return Promise.resolve({ keys: [] })
        }

        throw new Error(`Unexpected request: ${url}`)
      })

      const wrapper = await mountSuspended(CloudflareGateway)

      await flushPromises()

      expect((accountIdInput(wrapper).element as HTMLInputElement).value)
        .toBe('account-123')
      expect((gatewayIdInput(wrapper).element as HTMLInputElement).value)
        .toBe('my-gateway')
      expect((apiKeyInput(wrapper).element as HTMLInputElement).value)
        .toBe('')
      expect(deleteButton(wrapper)).toBeDefined()
      expect(wrapper.find('[data-testid="key-status-saved"]').exists())
        .toBe(true)
      expect((apiKeyInput(wrapper).element as HTMLInputElement).placeholder)
        .toBe('Enter a new token to replace the saved one')
    })

  it('saves credentials and shows a success message', async () => {
    const useSuccessMessage
      = vi.spyOn(messagesComposable, 'useSuccessMessage')

    const wrapper = await mountSuspended(CloudflareGateway)

    await flushPromises()

    await accountIdInput(wrapper).setValue('account-123')
    await gatewayIdInput(wrapper).setValue('my-gateway')
    await apiKeyInput(wrapper).setValue('super-secret-token')
    await wrapper.get('form').trigger('submit')

    await vi.waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/profiles/keys/cloudflare-gateway',
        expect.objectContaining({
          method: 'post',
          body: {
            accountId: 'account-123',
            gatewayId: 'my-gateway',
            apiKey: 'super-secret-token',
          },
        }),
      )
      expect(useSuccessMessage).toHaveBeenCalledWith(
        'Cloudflare AI Gateway credentials updated successfully',
      )
    })
  })

  it('omits gatewayId from the save payload when left blank', async () => {
    const wrapper = await mountSuspended(CloudflareGateway)

    await flushPromises()

    await accountIdInput(wrapper).setValue('account-123')
    await apiKeyInput(wrapper).setValue('super-secret-token')
    await wrapper.get('form').trigger('submit')

    await vi.waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/profiles/keys/cloudflare-gateway',
        expect.objectContaining({
          method: 'post',
          body: expect.objectContaining({ gatewayId: undefined }),
        }),
      )
    })
  })

  it('deletes credentials behind a confirmation', async () => {
    mocks.fetch.mockImplementation((url: string) => {
      if (url === '/api/v1/profiles/keys/cloudflare-gateway') {
        return Promise.resolve(credentialResponse({
          accountId: 'account-123',
          gatewayId: 'my-gateway',
          hasKey: true,
        }))
      }

      if (url === '/api/v1/profiles/keys') {
        return Promise.resolve({ keys: [] })
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    const useSuccessMessage
      = vi.spyOn(messagesComposable, 'useSuccessMessage')

    const wrapper = await mountSuspended(CloudflareGateway)

    await flushPromises()
    await deleteButton(wrapper)?.trigger('click')

    await vi.waitFor(() => {
      expect(mocks.confirm).toHaveBeenCalled()
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/profiles/keys/cloudflare-gateway',
        expect.objectContaining({ method: 'delete' }),
      )
      expect(useSuccessMessage).toHaveBeenCalledWith(
        'Cloudflare AI Gateway credentials deleted successfully',
      )
    })
  })

  it('does not delete when the confirmation is declined', async () => {
    mocks.confirm.mockResolvedValue(null)
    mocks.fetch.mockImplementation((url: string) => {
      if (url === '/api/v1/profiles/keys/cloudflare-gateway') {
        return Promise.resolve(credentialResponse({
          accountId: 'account-123',
          hasKey: true,
        }))
      }

      if (url === '/api/v1/profiles/keys') {
        return Promise.resolve({ keys: [] })
      }

      throw new Error(`Unexpected request: ${url}`)
    })

    const wrapper = await mountSuspended(CloudflareGateway)

    await flushPromises()
    await deleteButton(wrapper)?.trigger('click')

    await vi.waitFor(() => {
      expect(mocks.confirm).toHaveBeenCalled()
    })

    const deleteCalls = mocks.fetch.mock.calls.filter(([, options]) => {
      return options?.method === 'delete'
    })

    expect(deleteCalls).toHaveLength(0)
  })

  it('shows a Paste button on all three fields', async () => {
    const wrapper = await mountSuspended(CloudflareGateway)

    await flushPromises()

    expect(fieldPasteButton(wrapper, 'account-id-field').exists()).toBe(true)
    expect(fieldPasteButton(wrapper, 'gateway-id-field').exists()).toBe(true)
    expect(fieldPasteButton(wrapper, 'api-key-field').exists()).toBe(true)
  })

  it('pastes into Account ID and leaves Gateway ID and API Token untouched',
    async () => {
      mocks.paste.mockResolvedValue('account-from-clipboard')

      const wrapper = await mountSuspended(CloudflareGateway)

      await flushPromises()
      await gatewayIdInput(wrapper).setValue('existing-gateway')
      await apiKeyInput(wrapper).setValue('existing-token')
      await fieldPasteButton(wrapper, 'account-id-field').trigger('click')
      await flushPromises()

      expect((accountIdInput(wrapper).element as HTMLInputElement).value)
        .toBe('account-from-clipboard')
      expect((gatewayIdInput(wrapper).element as HTMLInputElement).value)
        .toBe('existing-gateway')
      expect((apiKeyInput(wrapper).element as HTMLInputElement).value)
        .toBe('existing-token')
    })

  it('pastes into Gateway ID and leaves Account ID and API Token untouched',
    async () => {
      mocks.paste.mockResolvedValue('gateway-from-clipboard')

      const wrapper = await mountSuspended(CloudflareGateway)

      await flushPromises()
      await accountIdInput(wrapper).setValue('existing-account')
      await apiKeyInput(wrapper).setValue('existing-token')
      await fieldPasteButton(wrapper, 'gateway-id-field').trigger('click')
      await flushPromises()

      expect((gatewayIdInput(wrapper).element as HTMLInputElement).value)
        .toBe('gateway-from-clipboard')
      expect((accountIdInput(wrapper).element as HTMLInputElement).value)
        .toBe('existing-account')
      expect((apiKeyInput(wrapper).element as HTMLInputElement).value)
        .toBe('existing-token')
    })
})
