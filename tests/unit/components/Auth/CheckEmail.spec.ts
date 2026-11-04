import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as messagesComposable from '../../../../app/composables/messages'
import CheckEmail from '../../../../app/components/Auth/CheckEmail.vue'

const mocks = vi.hoisted(() => ({
  sendVerificationEmail: vi.fn(async (..._args: any[]) => ({
    data: null,
    error: null as { message?: string } | null,
  })),
}))

mockNuxtImport('useAuth', () => {
  return () => ({
    client: { sendVerificationEmail: mocks.sendVerificationEmail },
  })
})

const props = {
  email: 'user@example.com',
  callbackUrl: '/signin?next=%2Fprofile%2Fkeys',
}

async function mountComponent() {
  return await mountSuspended(CheckEmail, { props })
}

function resendButton(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
  return wrapper.get('[data-testid="check-email-resend"]')
}

async function waitForCooldown() {
  await vi.advanceTimersByTimeAsync(60_000)
}

describe('Auth/CheckEmail', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.sendVerificationEmail.mockClear()
    mocks.sendVerificationEmail.mockResolvedValue({
      data: null,
      error: null,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('names the address the link was sent to', async () => {
    const wrapper = await mountComponent()

    expect(wrapper.get('[data-testid="check-email-address"]').text())
      .toBe('user@example.com')
  })

  it('starts with the resend button disabled and counting down',
    async () => {
      const wrapper = await mountComponent()

      expect(resendButton(wrapper).classes()).toContain('btn-disabled')
      expect(resendButton(wrapper).text()).toContain('Resend in 60s')

      await vi.advanceTimersByTimeAsync(10_000)

      expect(resendButton(wrapper).text()).toContain('Resend in 50s')
    })

  it('does not send while the cooldown is running', async () => {
    const wrapper = await mountComponent()

    await resendButton(wrapper).trigger('click')

    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled()
  })

  it('resends with the address and callback URL once the cooldown ends',
    async () => {
      const useSuccessMessage = vi.spyOn(
        messagesComposable,
        'useSuccessMessage',
      )
      const wrapper = await mountComponent()

      await waitForCooldown()

      expect(resendButton(wrapper).classes()).not.toContain('btn-disabled')

      await resendButton(wrapper).trigger('click')
      await vi.advanceTimersByTimeAsync(0)

      expect(mocks.sendVerificationEmail).toHaveBeenCalledWith({
        email: 'user@example.com',
        callbackURL: '/signin?next=%2Fprofile%2Fkeys',
      })
      expect(useSuccessMessage).toHaveBeenCalledWith(
        'Verification email sent',
      )
    })

  it('restarts the cooldown after a successful resend', async () => {
    const wrapper = await mountComponent()

    await waitForCooldown()
    await resendButton(wrapper).trigger('click')
    await vi.advanceTimersByTimeAsync(0)

    expect(resendButton(wrapper).classes()).toContain('btn-disabled')
    expect(resendButton(wrapper).text()).toContain('Resend in 60s')
  })

  it('shows the server error and allows another attempt when the resend '
    + 'is rejected', async () => {
    mocks.sendVerificationEmail.mockResolvedValue({
      data: null,
      error: { message: 'Too many requests' },
    })

    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')
    const wrapper = await mountComponent()

    await waitForCooldown()
    await resendButton(wrapper).trigger('click')
    await vi.advanceTimersByTimeAsync(0)

    expect(useErrorMessage).toHaveBeenCalledWith('Too many requests')
    expect(resendButton(wrapper).classes()).not.toContain('btn-disabled')
  })

  it('shows an error when the request throws', async () => {
    mocks.sendVerificationEmail.mockRejectedValue(new Error('Network down'))

    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')
    const wrapper = await mountComponent()

    await waitForCooldown()
    await resendButton(wrapper).trigger('click')
    await vi.advanceTimersByTimeAsync(0)

    expect(useErrorMessage).toHaveBeenCalled()
  })

  it('emits change-email from the use-a-different-address action',
    async () => {
      const wrapper = await mountComponent()

      await wrapper.get('[data-testid="check-email-change"]')
        .trigger('click')

      expect(wrapper.emitted('change-email')).toHaveLength(1)
    })
})
