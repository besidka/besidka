import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import ReportModal from '../../../../app/components/Artifact/ReportModal.client.vue'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  turnstileSiteKey: '',
  turnstileToken: 'turnstile-token',
  turnstileReset: vi.fn(),
}))

const loggedIn = ref<boolean>(false)
const user = ref<{ name: string, email: string } | null>(null)

mockNuxtImport('$fetch', () => mocks.fetch)

mockNuxtImport('useAuth', () => {
  return () => ({ loggedIn, user })
})

mockNuxtImport('useRuntimeConfig', (original) => {
  return () => {
    const config = original()

    return {
      ...config,
      public: { ...config.public, turnstileSiteKey: mocks.turnstileSiteKey },
    }
  }
})

const ENDPOINT = '/api/v1/artifact-shares/current/report'
const HEADERS = { 'x-besidka-artifact-share': 'token-1' }
const VALID_DETAILS = 'It asks visitors for their bank password.'

function byTestId(testId: string) {
  return `[data-testid="${testId}"]`
}

async function mountModal(options: {
  headers?: Record<string, string>
} = {}) {
  const wrapper = await mountSuspended(ReportModal, {
    props: {
      'open': false,
      'onUpdate:open': (value: boolean) => {
        wrapper.setProps({ open: value })
      },
      'title': 'Quiz',
      'endpoint': ENDPOINT,
      'headers': options.headers,
    },
    global: {
      stubs: {
        teleport: true,
        AuthTurnstile: {
          template: '<div data-testid="turnstile-stub" />',
          methods: {
            execute: () => Promise.resolve(mocks.turnstileToken),
            reset: mocks.turnstileReset,
          },
        },
      },
    },
  })

  await wrapper.setProps({ open: true })
  await flushPromises()

  return wrapper
}

async function fillValidForm(
  wrapper: VueWrapper,
  reason = 'phishing',
) {
  await wrapper.get(byTestId(`artifact-report-reason-${reason}`))
    .setValue(true)
  await wrapper.get(byTestId('artifact-report-details'))
    .setValue(VALID_DETAILS)
  await wrapper.get(byTestId('artifact-report-name')).setValue('Ann Lee')
  await wrapper.get(byTestId('artifact-report-email'))
    .setValue('ann@example.test')
  await wrapper.get(byTestId('artifact-report-good-faith')).setValue(true)
}

async function submit(wrapper: VueWrapper) {
  await wrapper.get(byTestId('artifact-report-form')).trigger('submit')
  await flushPromises()
}

describe('Artifact/ReportModal.client', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.fetch.mockResolvedValue({ ok: true })
    mocks.turnstileSiteKey = ''
    mocks.turnstileToken = 'turnstile-token'
    mocks.turnstileReset.mockReset()
    loggedIn.value = false
    user.value = null
    const openDialogs = new WeakSet<HTMLDialogElement>()

    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function (this: HTMLDialogElement) {
        openDialogs.add(this)
        Object.defineProperty(this, 'open', {
          configurable: true,
          get: () => openDialogs.has(this),
        })
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function (this: HTMLDialogElement) {
        openDialogs.delete(this)
        this.dispatchEvent(new Event('close'))
      })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens as a labelled bottom-sheet dialog with all nine reasons',
    async () => {
      const wrapper = await mountModal()
      const dialog = wrapper.get(byTestId('artifact-report-modal'))

      expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled()
      expect(dialog.classes()).toEqual(expect.arrayContaining([
        'modal',
        'modal-bottom',
        'sm:modal-middle',
      ]))
      expect(dialog.attributes('aria-labelledby')).toBeTruthy()
      expect(wrapper.findAll('input[type="radio"]')).toHaveLength(9)
      expect(wrapper.get(byTestId('artifact-report-reasons')).text())
        .toContain('Child sexual abuse material')
      expect(wrapper.get(byTestId('artifact-report-title')).text())
        .toBe('Quiz')
    })

  it('labels every field', async () => {
    const wrapper = await mountModal()
    const fields = wrapper.findAll(
      'input[type="text"], input[type="email"], textarea',
    )

    for (const field of fields) {
      const id = field.attributes('id')

      expect(id).toBeTruthy()
      expect(wrapper.find(`label[for="${id}"]`).exists()).toBe(true)
    }
  })

  it('counts the details as they are typed', async () => {
    const wrapper = await mountModal()

    await wrapper.get(byTestId('artifact-report-details'))
      .setValue('Twelve chars')

    expect(wrapper.get(byTestId('artifact-report-details-count')).text())
      .toContain('12 / 2000')
  })

  it('blocks an incomplete report and ties each error to its field',
    async () => {
      const wrapper = await mountModal()

      await wrapper.get(byTestId('artifact-report-details'))
        .setValue('too short')
      await submit(wrapper)

      expect(mocks.fetch).not.toHaveBeenCalled()
      expect(wrapper.get(byTestId('artifact-report-reason-error')).text())
        .toBe('Choose a reason.')

      const details = wrapper.get(byTestId('artifact-report-details'))
      const errorId = wrapper.get(byTestId('artifact-report-details-error'))
        .attributes('id')

      expect(details.attributes('aria-invalid')).toBe('true')
      expect(details.attributes('aria-describedby')).toContain(errorId)
      expect(wrapper.get(byTestId('artifact-report-name'))
        .attributes('aria-invalid')).toBe('true')
      expect(wrapper.get(byTestId('artifact-report-good-faith'))
        .attributes('aria-invalid')).toBe('true')
    })

  it('posts a complete report with the share header', async () => {
    const wrapper = await mountModal({ headers: HEADERS })

    await fillValidForm(wrapper)
    await submit(wrapper)

    expect(mocks.fetch).toHaveBeenCalledWith(ENDPOINT, {
      method: 'POST',
      headers: HEADERS,
      body: {
        reason: 'phishing',
        details: VALID_DETAILS,
        reporterName: 'Ann Lee',
        reporterEmail: 'ann@example.test',
        goodFaith: true,
      },
    })
    expect(wrapper.find(byTestId('artifact-report-success')).text())
      .toContain('ann@example.test')
  })

  it('lets a csam report go without name or email', async () => {
    const wrapper = await mountModal()

    await wrapper.get(byTestId('artifact-report-reason-csam')).setValue(true)

    expect(wrapper.get(byTestId('artifact-report-modal')).text())
      .toContain('Your email (optional)')
    expect(wrapper.find(byTestId('artifact-report-urgent')).exists())
      .toBe(true)

    await wrapper.get(byTestId('artifact-report-details'))
      .setValue(VALID_DETAILS)
    await wrapper.get(byTestId('artifact-report-good-faith')).setValue(true)
    await submit(wrapper)

    expect(mocks.fetch).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({
      body: {
        reason: 'csam',
        details: VALID_DETAILS,
        goodFaith: true,
      },
    }))
  })

  it('asks for the copyright notice elements and sends them', async () => {
    const wrapper = await mountModal()

    await fillValidForm(wrapper, 'copyright')

    expect(wrapper.find(byTestId('artifact-report-copyright')).exists())
      .toBe(true)

    await submit(wrapper)

    expect(mocks.fetch).not.toHaveBeenCalled()

    await wrapper.get(byTestId('artifact-report-copyright-work'))
      .setValue('My novel, chapter 3, published at example.test')
    await wrapper.get(byTestId('artifact-report-copyright-owner'))
      .setValue('Lee Books')
    await wrapper.get(byTestId('artifact-report-copyright-unauthorised'))
      .setValue(true)
    await wrapper.get(byTestId('artifact-report-copyright-authority'))
      .setValue(true)
    await wrapper.get(byTestId('artifact-report-copyright-signature'))
      .setValue('Ann Lee')
    await submit(wrapper)

    expect(mocks.fetch).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({
      body: expect.objectContaining({
        reason: 'copyright',
        copyright: {
          work: 'My novel, chapter 3, published at example.test',
          signature: 'Ann Lee',
          ownerName: 'Lee Books',
          unauthorisedUse: true,
          authority: true,
        },
      }),
    }))
  })

  it('runs Turnstile for a signed-out reporter when a site key is set',
    async () => {
      mocks.turnstileSiteKey = 'site-key'

      const wrapper = await mountModal()

      expect(wrapper.find(byTestId('turnstile-stub')).exists()).toBe(true)

      await fillValidForm(wrapper)
      await submit(wrapper)

      const [, options] = mocks.fetch.mock.calls[0]!

      expect(options.body.turnstileToken).toBe('turnstile-token')
    })

  it('skips Turnstile without a site key', async () => {
    const wrapper = await mountModal()

    expect(wrapper.find(byTestId('turnstile-stub')).exists()).toBe(false)

    await fillValidForm(wrapper)
    await submit(wrapper)

    const [, options] = mocks.fetch.mock.calls[0]!

    expect(options.body).not.toHaveProperty('turnstileToken')
  })

  it('skips Turnstile for a signed-in reporter and prefills the contact',
    async () => {
      mocks.turnstileSiteKey = 'site-key'
      loggedIn.value = true
      user.value = { name: 'Signed In', email: 'signed@example.test' }

      const wrapper = await mountModal()

      expect(wrapper.find(byTestId('turnstile-stub')).exists()).toBe(false)
      expect((wrapper.get(byTestId('artifact-report-email'))
        .element as HTMLInputElement).value).toBe('signed@example.test')
      expect((wrapper.get(byTestId('artifact-report-name'))
        .element as HTMLInputElement).value).toBe('Signed In')
    })

  it('shows the server reason inside the dialog when sending fails',
    async () => {
      mocks.fetch.mockRejectedValue(Object.assign(new Error('Too many'), {
        statusCode: 429,
        data: {
          message: 'Too many reports',
          why: 'Five reports an hour at most',
        },
      }))

      const wrapper = await mountModal()

      await fillValidForm(wrapper)
      await submit(wrapper)

      const alert = wrapper.get(byTestId('artifact-report-error'))

      expect(alert.attributes('role')).toBe('alert')
      expect(alert.text()).toContain('Too many reports')
      expect(alert.text()).toContain('Five reports an hour at most')
      expect(wrapper.find(byTestId('artifact-report-success')).exists())
        .toBe(false)
    })

  it('returns focus to the element that opened it', async () => {
    const trigger = document.createElement('button')

    document.body.appendChild(trigger)
    trigger.focus()

    const wrapper = await mountModal()

    wrapper.get(byTestId('artifact-report-close')).element.focus()
    await wrapper.get(byTestId('artifact-report-close')).trigger('click')
    await flushPromises()

    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])

    wrapper.get(byTestId('artifact-report-modal')).element
      .dispatchEvent(new Event('close'))
    await flushPromises()

    expect(document.activeElement).toBe(trigger)

    trigger.remove()
  })
})
