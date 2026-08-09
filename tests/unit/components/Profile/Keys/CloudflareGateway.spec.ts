import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as messagesComposable from '../../../../../app/composables/messages'
import CloudflareGateway from '../../../../../app/components/Profile/Keys/CloudflareGateway.vue'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  confirm: vi.fn(async () => ({ label: 'Confirm', index: 0 })),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useConfirm', () => mocks.confirm)

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
  return wrapper.find('input[placeholder="a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"]')
}

function gatewayIdInput(wrapper: any) {
  return wrapper.find('input[placeholder="default"]')
}

function apiKeyInput(wrapper: any) {
  return wrapper.find('input[placeholder="xxxx..."]')
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
})
