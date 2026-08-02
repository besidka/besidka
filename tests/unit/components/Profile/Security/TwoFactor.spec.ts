import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TwoFactor from '../../../../../app/components/Profile/Security/TwoFactor.vue'

const mocks = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  enable: vi.fn(async () => ({
    data: {
      totpURI:
        'otpauth://totp/Besidka:user%40example.com?secret=JBSWY3DPEHPK3PXP'
        + '&issuer=Besidka',
      backupCodes: ['abcde-fghij', 'klmno-pqrst'],
    },
    error: null,
  })),
  verifyTotp: vi.fn(async () => ({ data: { status: true }, error: null })),
  disable: vi.fn(async () => ({ data: { status: true }, error: null })),
  generateBackupCodes: vi.fn(async () => ({
    data: { status: true, backupCodes: ['zzzzz-yyyyy'] },
    error: null,
  })),
  confirm: vi.fn(async () => ({ label: 'Confirm', index: 0 })),
}))

const errorCodes = {
  INVALID_PASSWORD: {
    code: 'INVALID_PASSWORD',
    message: 'Invalid password',
  },
  INVALID_CODE: {
    code: 'INVALID_CODE',
    message: 'Invalid code',
  },
}

function createAccount(providerId: string) {
  return {
    id: `${providerId}-1`,
    providerId,
    accountId: `${providerId}-account`,
    userId: '1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    scopes: [],
  }
}

function createAuthMock(twoFactorEnabled: boolean) {
  return {
    user: { value: { twoFactorEnabled } },
    errorCodes,
    fetchSession: vi.fn(async () => undefined),
    client: {
      listAccounts: mocks.listAccounts,
      twoFactor: {
        enable: mocks.enable,
        verifyTotp: mocks.verifyTotp,
        disable: mocks.disable,
        generateBackupCodes: mocks.generateBackupCodes,
      },
    },
  }
}

let authMock = createAuthMock(false)

mockNuxtImport('useAuth', () => {
  return () => authMock
})

mockNuxtImport('useConfirm', () => mocks.confirm)

vi.mock('~/utils/qr-code', () => ({
  encodeQrCode: vi.fn(() => [[true]]),
  qrMatrixToSvg: vi.fn(() => '<svg data-testid="mock-qr"></svg>'),
}))

function stubs() {
  return {
    ProfileSecurityBackupCodes: {
      props: ['open', 'codes'],
      emits: ['acknowledge'],
      template: '<div data-testid="backup-codes-stub" '
        + ':data-open="open" :data-codes="codes.join(\',\')">'
        + '<button data-testid="backup-codes-stub-ack" '
        + '@click="$emit(\'acknowledge\')" /></div>',
    },
  }
}

async function flushPromises() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

function passwordInput(wrapper: any) {
  return wrapper.find('input[type="password"]')
}

describe('Profile/Security/TwoFactor', () => {
  beforeEach(() => {
    mocks.listAccounts.mockReset()
    mocks.enable.mockClear()
    mocks.verifyTotp.mockClear()
    mocks.disable.mockClear()
    mocks.generateBackupCodes.mockClear()
    mocks.confirm.mockReset()
    mocks.confirm.mockResolvedValue({ label: 'Confirm', index: 0 })
    mocks.listAccounts.mockResolvedValue({
      data: [createAccount('credential')],
      error: null,
    })
    mocks.enable.mockResolvedValue({
      data: {
        totpURI:
          'otpauth://totp/Besidka:user%40example.com?secret=JBSWY3DPEHPK3PXP'
          + '&issuer=Besidka',
        backupCodes: ['abcde-fghij', 'klmno-pqrst'],
      },
      error: null,
    })
    mocks.verifyTotp.mockResolvedValue({
      data: { status: true },
      error: null,
    })
  })

  it(
    'shows an explanatory message instead of the enable flow for a '
    + 'Google/GitHub-only account',
    async () => {
      mocks.listAccounts.mockResolvedValue({
        data: [createAccount('google')],
        error: null,
      })
      authMock = createAuthMock(false)

      const wrapper = await mountSuspended(TwoFactor, {
        global: { stubs: stubs() },
      })

      await flushPromises()

      expect(wrapper.text()).toContain('No password on this account')
      expect(wrapper.find('[data-testid="two-factor-enable"]').exists())
        .toBe(false)
    },
  )

  it(
    'walks the enable sequence through password, setup, and backup codes '
    + 'in order',
    async () => {
      authMock = createAuthMock(false)

      const wrapper = await mountSuspended(TwoFactor, {
        global: { stubs: stubs() },
      })

      await flushPromises()

      await wrapper.get('[data-testid="two-factor-enable"]').trigger('click')
      await flushPromises()

      expect(passwordInput(wrapper).exists()).toBe(true)
      expect(wrapper.find('[data-testid="two-factor-qr-code"]').exists())
        .toBe(false)

      await passwordInput(wrapper).setValue('CurrentPass1!')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(mocks.enable).toHaveBeenCalledWith({
        password: 'CurrentPass1!',
      })
      expect(passwordInput(wrapper).exists()).toBe(false)
      expect(wrapper.find('[data-testid="two-factor-manual-secret"]')
        .text()).toBe('JBSWY3DPEHPK3PXP')

      const otpInput = wrapper.get('input[type="text"]')

      await otpInput.setValue('123456')
      await flushPromises()

      expect(mocks.verifyTotp).toHaveBeenCalledWith({ code: '123456' })

      const backupCodesStub = wrapper.get(
        '[data-testid="backup-codes-stub"]',
      )

      expect(backupCodesStub.attributes('data-open')).toBe('true')
      expect(backupCodesStub.attributes('data-codes'))
        .toBe('abcde-fghij,klmno-pqrst')
    },
  )

  it('gates turning off behind a confirmation and the account password',
    async () => {
      authMock = createAuthMock(true)

      const wrapper = await mountSuspended(TwoFactor, {
        global: { stubs: stubs() },
      })

      await flushPromises()

      await wrapper.get('[data-testid="two-factor-turn-off"]')
        .trigger('click')
      await flushPromises()

      expect(mocks.confirm).toHaveBeenCalled()
      expect(passwordInput(wrapper).exists()).toBe(true)
      expect(mocks.disable).not.toHaveBeenCalled()

      await passwordInput(wrapper).setValue('CurrentPass1!')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(mocks.disable).toHaveBeenCalledWith({
        password: 'CurrentPass1!',
      })
    })

  it('does not turn off when the confirmation is declined', async () => {
    authMock = createAuthMock(true)
    mocks.confirm.mockResolvedValue(null)

    const wrapper = await mountSuspended(TwoFactor, {
      global: { stubs: stubs() },
    })

    await flushPromises()

    await wrapper.get('[data-testid="two-factor-turn-off"]').trigger('click')
    await flushPromises()

    expect(mocks.confirm).toHaveBeenCalled()
    expect(passwordInput(wrapper).exists()).toBe(false)
    expect(mocks.disable).not.toHaveBeenCalled()
  })

  it(
    'gates regenerating backup codes behind a confirmation and the '
    + 'account password',
    async () => {
      authMock = createAuthMock(true)

      const wrapper = await mountSuspended(TwoFactor, {
        global: { stubs: stubs() },
      })

      await flushPromises()

      await wrapper.get('[data-testid="two-factor-regenerate"]')
        .trigger('click')
      await flushPromises()

      expect(mocks.confirm).toHaveBeenCalled()
      expect(passwordInput(wrapper).exists()).toBe(true)
      expect(mocks.generateBackupCodes).not.toHaveBeenCalled()

      await passwordInput(wrapper).setValue('CurrentPass1!')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(mocks.generateBackupCodes).toHaveBeenCalledWith({
        password: 'CurrentPass1!',
      })

      const backupCodesStub = wrapper.get(
        '[data-testid="backup-codes-stub"]',
      )

      expect(backupCodesStub.attributes('data-open')).toBe('true')
      expect(backupCodesStub.attributes('data-codes')).toBe('zzzzz-yyyyy')
    },
  )
})
