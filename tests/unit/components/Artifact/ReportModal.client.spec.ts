import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest'
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
  version?: number | null
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
      'version': options.version,
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

  it('keeps every row at its content height when the form scrolls',
    async () => {
      const wrapper = await mountModal()
      const form = wrapper.get(byTestId('artifact-report-form'))
      const goodFaithRow = wrapper
        .get(byTestId('artifact-report-good-faith'))
        .element
        .closest('label')

      expect(form.classes()).toEqual(expect.arrayContaining([
        'overflow-y-auto',
        '*:shrink-0',
      ]))
      expect(goodFaithRow?.parentElement).toBe(form.element)
      expect(goodFaithRow?.classList.contains('whitespace-normal')).toBe(true)
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

  it('keeps the dialog still on an incomplete submit', async () => {
    const wrapper = await mountModal()
    const scrollIntoView = vi.fn()
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')
    const windowScroll = vi.spyOn(window, 'scrollTo')

    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    onTestFinished(() => {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    })

    await wrapper.get(byTestId('artifact-report-details')).setValue('four')
    await wrapper.get(byTestId('artifact-report-reason-phishing'))
      .setValue(true)
    await submit(wrapper)

    const details = wrapper.get(byTestId('artifact-report-details'))

    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true })
    expect(focusSpy.mock.contexts).toContain(details.element)
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(windowScroll).not.toHaveBeenCalled()
    expect(wrapper.get(byTestId('artifact-report-details-error')).text())
      .toBe('Write at least 20 characters.')
    expect(wrapper.get(byTestId('artifact-report-form'))
      .attributes('novalidate')).toBeDefined()
  })

  it('scrolls the form, not the page, to the first invalid field',
    async () => {
      const wrapper = await mountModal()

      await wrapper.get(byTestId('artifact-report-reason-phishing'))
        .setValue(true)
      await wrapper.get(byTestId('artifact-report-details'))
        .setValue('four')

      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockImplementation(function (this: HTMLElement) {
          const testId = this.getAttribute('data-testid')

          if (testId === 'artifact-report-form') {
            return { top: 100, bottom: 400 } as DOMRect
          }

          if (testId === 'artifact-report-details') {
            return { top: 500, bottom: 560 } as DOMRect
          }

          if (testId === 'artifact-report-details-error') {
            return { top: 580, bottom: 700 } as DOMRect
          }

          return { top: 0, bottom: 0 } as DOMRect
        })

      const scrollTops = new Map<HTMLElement, number>()

      Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
        configurable: true,
        get(this: HTMLElement) {
          return scrollTops.get(this) ?? 0
        },
        set(this: HTMLElement, value: number) {
          scrollTops.set(this, value)
        },
      })
      onTestFinished(() => {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollTop')
      })

      await submit(wrapper)

      const scrolledElements = [...scrollTops.entries()]

      expect(scrolledElements).toHaveLength(1)
      expect(scrolledElements[0]![0].dataset.testid)
        .toBe('artifact-report-form')
      expect(scrolledElements[0]![1]).toBe(700 + 8 - 400)
    })

  it('leaves the sheet lift to the global dialog rules', async () => {
    const wrapper = await mountModal()
    const box = wrapper.get(byTestId('artifact-report-box'))

    expect(box.classes()).toContain('sheet-safe-padding')
    expect(box.attributes('style') ?? '').not.toContain('margin-bottom')
    expect(box.attributes('style') ?? '').not.toContain('max-height')
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

  it('sends the version shown in the panel', async () => {
    const wrapper = await mountModal({ version: 3 })

    await fillValidForm(wrapper)
    await submit(wrapper)

    const [, options] = mocks.fetch.mock.calls[0]!

    expect(options.body.version).toBe(3)
  })

  it('tells a signed-in reporter the receipt goes to the account email',
    async () => {
      loggedIn.value = true
      user.value = { name: 'Signed In', email: 'signed@example.test' }

      const wrapper = await mountModal()

      expect(wrapper.text()).toContain(
        'We send the receipt to your account email and the decision to this '
        + 'address.',
      )

      await fillValidForm(wrapper)
      await submit(wrapper)

      expect(wrapper.get(byTestId('artifact-report-success')).text())
        .toContain('a receipt goes to your account email')
      expect(wrapper.get(byTestId('artifact-report-success')).text())
        .not.toContain('ann@example.test')
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
