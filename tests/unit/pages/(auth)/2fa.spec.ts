import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as messagesComposable from '../../../../app/composables/messages'
import TwoFactorPage from '../../../../app/pages/(auth)/2fa.vue'

const mocks = vi.hoisted(() => ({
  verifyTotp: vi.fn(async () => ({ data: { status: true }, error: null })),
  verifyBackupCode: vi.fn(async () => ({
    data: { status: true },
    error: null,
  })),
  fetchSession: vi.fn(async () => undefined),
  navigateTo: vi.fn(async () => undefined),
}))

const errorCodes = {
  INVALID_CODE: { code: 'INVALID_CODE', message: 'Invalid code' },
  INVALID_BACKUP_CODE: {
    code: 'INVALID_BACKUP_CODE',
    message: 'Invalid backup code',
  },
  ACCOUNT_TEMPORARILY_LOCKED: {
    code: 'ACCOUNT_TEMPORARILY_LOCKED',
    message: 'Account temporarily locked',
  },
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: {
    code: 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE',
    message: 'Too many attempts',
  },
  INVALID_TWO_FACTOR_COOKIE: {
    code: 'INVALID_TWO_FACTOR_COOKIE',
    message: 'Invalid two factor cookie',
  },
}

mockNuxtImport('useAuth', () => {
  return () => ({
    client: {
      twoFactor: {
        verifyTotp: mocks.verifyTotp,
        verifyBackupCode: mocks.verifyBackupCode,
      },
    },
    errorCodes,
    options: {
      redirectUserTo: '/chats/new',
      redirectGuestTo: '/signin',
    },
    fetchSession: mocks.fetchSession,
  })
})

mockNuxtImport('navigateTo', () => mocks.navigateTo)

async function flushPromises() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

function codeInput(wrapper: any) {
  return wrapper.get('input[type="text"]')
}

describe('two-factor verification page', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useSeoMeta', vi.fn())
    mocks.verifyTotp.mockClear()
    mocks.verifyBackupCode.mockClear()
    mocks.fetchSession.mockClear()
    mocks.navigateTo.mockClear()
    mocks.verifyTotp.mockResolvedValue({
      data: { status: true },
      error: null,
    })
    mocks.verifyBackupCode.mockResolvedValue({
      data: { status: true },
      error: null,
    })
  })

  it('is a guest-only, noindex page', () => {
    const source = readFileSync(
      join(process.cwd(), 'app/pages/(auth)/2fa.vue'),
      'utf-8',
    )

    expect(source).toMatch(
      /definePageMeta\(\{\s*layout:\s*'auth',\s*auth:\s*\{\s*only:\s*'guest',?\s*\},?\s*\}\)/,
    )
    expect(source).toMatch(/title:\s*'Two-factor authentication'/)
    expect(source).toMatch(/robots:\s*'noindex,\s*nofollow'/)
  })

  it('auto-submits the totp code once six digits are entered', async () => {
    const wrapper = await mountSuspended(TwoFactorPage)

    await codeInput(wrapper).setValue('123456')
    await flushPromises()

    expect(mocks.verifyTotp).toHaveBeenCalledWith({
      code: '123456',
      trustDevice: false,
    })
  })

  it('forwards the trust-device checkbox to the verify call', async () => {
    const wrapper = await mountSuspended(TwoFactorPage)

    await wrapper.get('input[type="checkbox"]').setValue(true)
    await codeInput(wrapper).setValue('123456')
    await flushPromises()

    expect(mocks.verifyTotp).toHaveBeenCalledWith({
      code: '123456',
      trustDevice: true,
    })
  })

  it('switches to backup-code verification when toggled', async () => {
    const wrapper = await mountSuspended(TwoFactorPage)

    await wrapper.get('[data-testid="two-factor-toggle-backup-code"]')
      .trigger('click')
    await codeInput(wrapper).setValue('abcde-fghij')
    await flushPromises()

    expect(mocks.verifyBackupCode).toHaveBeenCalledWith({
      code: 'abcde-fghij',
      trustDevice: false,
    })
    expect(mocks.verifyTotp).not.toHaveBeenCalled()
  })

  it('navigates into the app on a successful verification', async () => {
    const wrapper = await mountSuspended(TwoFactorPage)

    await codeInput(wrapper).setValue('123456')
    await flushPromises()

    expect(mocks.fetchSession).toHaveBeenCalled()
    expect(mocks.navigateTo).toHaveBeenCalledWith('/chats/new')
  })

  it('maps a wrong code to a friendly message', async () => {
    mocks.verifyTotp.mockResolvedValue({
      data: null,
      error: errorCodes.INVALID_CODE,
    })

    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')
    const wrapper = await mountSuspended(TwoFactorPage)

    await codeInput(wrapper).setValue('123456')
    await flushPromises()

    expect(useErrorMessage).toHaveBeenCalledWith(
      'Wrong code',
      'Check your authenticator app and try again.',
    )
    expect(mocks.navigateTo).not.toHaveBeenCalled()
  })

  it('maps a wrong or already-used backup code to a friendly message',
    async () => {
      mocks.verifyBackupCode.mockResolvedValue({
        data: null,
        error: errorCodes.INVALID_BACKUP_CODE,
      })

      const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')
      const wrapper = await mountSuspended(TwoFactorPage)

      await wrapper.get('[data-testid="two-factor-toggle-backup-code"]')
        .trigger('click')
      await codeInput(wrapper).setValue('abcde-fghij')
      await flushPromises()

      expect(useErrorMessage).toHaveBeenCalledWith(
        'Invalid backup code',
        'That code is wrong or has already been used.',
      )
    })

  it('maps repeated failed attempts to a temporarily-locked message',
    async () => {
      mocks.verifyTotp.mockResolvedValue({
        data: null,
        error: errorCodes.ACCOUNT_TEMPORARILY_LOCKED,
      })

      const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')
      const wrapper = await mountSuspended(TwoFactorPage)

      await codeInput(wrapper).setValue('123456')
      await flushPromises()

      expect(useErrorMessage).toHaveBeenCalledWith(
        'Too many failed attempts',
        'Your account is temporarily locked. Please wait a while '
        + 'before trying again.',
      )
    })

  it('sends the person back to sign in on an expired/invalid challenge',
    async () => {
      mocks.verifyTotp.mockResolvedValue({
        data: null,
        error: errorCodes.INVALID_TWO_FACTOR_COOKIE,
      })

      const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')
      const wrapper = await mountSuspended(TwoFactorPage)

      await codeInput(wrapper).setValue('123456')
      await flushPromises()

      expect(useErrorMessage).toHaveBeenCalledWith(
        'Sign-in attempt timed out',
        'Please sign in again to start a new verification.',
      )
      expect(mocks.navigateTo).toHaveBeenCalledWith('/signin')
    })
})
