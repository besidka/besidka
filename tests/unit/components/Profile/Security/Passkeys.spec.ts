import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as messagesComposable from '../../../../../app/composables/messages'
import Passkeys from '../../../../../app/components/Profile/Security/Passkeys.vue'

const mocks = vi.hoisted(() => ({
  listUserPasskeys: vi.fn(),
  addPasskey: vi.fn(),
  updatePasskey: vi.fn(),
  deletePasskey: vi.fn(),
  confirm: vi.fn(async () => ({ label: 'Delete', index: 0 })),
}))

function createPasskeyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    name: 'MacBook Chrome',
    createdAt: '2026-01-01T00:00:00.000Z',
    backedUp: true,
    ...overrides,
  }
}

mockNuxtImport('useAuth', () => {
  return () => ({
    client: {
      passkey: {
        listUserPasskeys: mocks.listUserPasskeys,
        addPasskey: mocks.addPasskey,
        updatePasskey: mocks.updatePasskey,
        deletePasskey: mocks.deletePasskey,
      },
    },
  })
})

mockNuxtImport('useConfirm', () => mocks.confirm)

function stubWebAuthnSupport() {
  vi.stubGlobal('PublicKeyCredential', {})
}

async function waitForLoaded(wrapper: any) {
  await vi.waitFor(() => {
    expect(wrapper.find('.skeleton').exists()).toBe(false)
  })
}

function addButton(wrapper: any) {
  return wrapper.find('[data-testid="passkeys-add"]')
}

function nameInput(wrapper: any) {
  return wrapper.find('input[placeholder="Name this passkey"]')
}

describe('Profile/Security/Passkeys', () => {
  beforeEach(() => {
    mocks.listUserPasskeys.mockReset()
    mocks.addPasskey.mockReset()
    mocks.updatePasskey.mockReset()
    mocks.deletePasskey.mockReset()
    mocks.confirm.mockReset()
    mocks.confirm.mockResolvedValue({ label: 'Delete', index: 0 })
    mocks.listUserPasskeys.mockResolvedValue({ data: [], error: null })
    mocks.addPasskey.mockResolvedValue({
      data: createPasskeyRow(),
      error: null,
    })
    mocks.updatePasskey.mockResolvedValue({
      data: { passkey: createPasskeyRow() },
      error: null,
    })
    mocks.deletePasskey.mockResolvedValue({
      data: { status: true },
      error: null,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the registered passkeys with their sync status and date',
    async () => {
      mocks.listUserPasskeys.mockResolvedValue({
        data: [
          createPasskeyRow({ id: '1', name: 'Synced key', backedUp: true }),
          createPasskeyRow({
            id: '2',
            name: 'Local key',
            backedUp: false,
          }),
        ],
        error: null,
      })
      stubWebAuthnSupport()

      const wrapper = await mountSuspended(Passkeys)

      await waitForLoaded(wrapper)

      const rows = wrapper.findAll('[data-testid="passkey-row"]')

      expect(rows).toHaveLength(2)
      expect(rows[0]!.text()).toContain('Synced key')
      expect(rows[0]!.text()).toContain('Synced across devices')
      expect(rows[1]!.text()).toContain('Local key')
      expect(rows[1]!.text()).toContain('This device only')
    })

  it('shows an explanatory line and hides the Add affordance when '
    + 'WebAuthn is not available', async () => {
    const wrapper = await mountSuspended(Passkeys)

    await waitForLoaded(wrapper)

    expect(wrapper.find('[data-testid="passkeys-unsupported"]').exists())
      .toBe(true)
    expect(addButton(wrapper).exists()).toBe(false)
  })

  it('shows the Add button when WebAuthn is available', async () => {
    stubWebAuthnSupport()

    const wrapper = await mountSuspended(Passkeys)

    await waitForLoaded(wrapper)

    expect(addButton(wrapper).exists()).toBe(true)
    expect(wrapper.find('[data-testid="passkeys-unsupported"]').exists())
      .toBe(false)
  })

  it('prompts for a nickname pre-filled with a device guess, then '
    + 'registers the passkey', async () => {
    stubWebAuthnSupport()

    const useSuccessMessage
      = vi.spyOn(messagesComposable, 'useSuccessMessage')

    const wrapper = await mountSuspended(Passkeys)

    await waitForLoaded(wrapper)
    await addButton(wrapper).trigger('click')

    const addNameInput = nameInput(wrapper)

    expect(addNameInput.exists()).toBe(true)
    expect((addNameInput.element as HTMLInputElement).value.length)
      .toBeGreaterThan(0)

    await addNameInput.setValue('My laptop')
    await wrapper.get('form').trigger('submit')

    await vi.waitFor(() => {
      expect(mocks.addPasskey).toHaveBeenCalledWith({ name: 'My laptop' })
    })
    expect(useSuccessMessage).toHaveBeenCalledWith('Passkey added')
    expect(nameInput(wrapper).exists()).toBe(false)
  })

  it('treats a cancelled registration ceremony as a quiet no-op, not '
    + 'an error toast', async () => {
    stubWebAuthnSupport()
    mocks.addPasskey.mockResolvedValue({
      data: null,
      error: {
        code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',
        message: 'The operation either timed out or was not allowed.',
      },
    })

    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    const wrapper = await mountSuspended(Passkeys)

    await waitForLoaded(wrapper)
    await addButton(wrapper).trigger('click')
    await wrapper.get('form').trigger('submit')

    await vi.waitFor(() => {
      expect(mocks.addPasskey).toHaveBeenCalled()
    })
    expect(useErrorMessage).not.toHaveBeenCalled()
    expect(nameInput(wrapper).exists()).toBe(true)
  })

  it('shows an error toast for a genuine registration failure',
    async () => {
      stubWebAuthnSupport()
      mocks.addPasskey.mockResolvedValue({
        data: null,
        error: { message: 'Something went wrong' },
      })

      const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

      const wrapper = await mountSuspended(Passkeys)

      await waitForLoaded(wrapper)
      await addButton(wrapper).trigger('click')
      await wrapper.get('form').trigger('submit')

      await vi.waitFor(() => {
        expect(useErrorMessage).toHaveBeenCalledWith('Something went wrong')
      })
    })

  it('renames a passkey', async () => {
    stubWebAuthnSupport()
    mocks.listUserPasskeys.mockResolvedValue({
      data: [createPasskeyRow({ id: '1', name: 'Old name' })],
      error: null,
    })

    const useSuccessMessage
      = vi.spyOn(messagesComposable, 'useSuccessMessage')

    const wrapper = await mountSuspended(Passkeys)

    await waitForLoaded(wrapper)
    await wrapper.get('[data-testid="passkeys-rename-1"]').trigger('click')

    const renameInput = nameInput(wrapper)

    await renameInput.setValue('New name')
    await wrapper.get('form').trigger('submit')

    await vi.waitFor(() => {
      expect(mocks.updatePasskey).toHaveBeenCalledWith({
        id: '1',
        name: 'New name',
      })
    })
    expect(useSuccessMessage).toHaveBeenCalledWith('Passkey renamed')
  })

  it('deletes a passkey behind a confirmation', async () => {
    stubWebAuthnSupport()
    mocks.listUserPasskeys.mockResolvedValue({
      data: [createPasskeyRow({ id: '1' })],
      error: null,
    })

    const useSuccessMessage
      = vi.spyOn(messagesComposable, 'useSuccessMessage')

    const wrapper = await mountSuspended(Passkeys)

    await waitForLoaded(wrapper)
    await wrapper.get('[data-testid="passkeys-delete-1"]').trigger('click')

    await vi.waitFor(() => {
      expect(mocks.confirm).toHaveBeenCalled()
      expect(mocks.deletePasskey).toHaveBeenCalledWith({ id: '1' })
    })
    expect(useSuccessMessage).toHaveBeenCalledWith('Passkey deleted')
  })

  it('does not delete when the confirmation is declined', async () => {
    stubWebAuthnSupport()
    mocks.confirm.mockResolvedValue(null)
    mocks.listUserPasskeys.mockResolvedValue({
      data: [createPasskeyRow({ id: '1' })],
      error: null,
    })

    const wrapper = await mountSuspended(Passkeys)

    await waitForLoaded(wrapper)
    await wrapper.get('[data-testid="passkeys-delete-1"]').trigger('click')

    await vi.waitFor(() => {
      expect(mocks.confirm).toHaveBeenCalled()
    })
    expect(mocks.deletePasskey).not.toHaveBeenCalled()
  })
})
