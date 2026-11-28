import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import ConnectorPickerGoogleRow from '../../../../app/components/ChatInput/ConnectorPickerGoogleRow.vue'
import type {
  ComposerGoogleRow,
} from '../../../../app/composables/composer-google-tools'

enableAutoUnmount(afterEach)

const SWITCH_ROW: ComposerGoogleRow = {
  entryId: 'google-gmail',
  service: 'gmail',
  title: 'Gmail',
  icon: 'logos:google-gmail',
  kind: 'switch',
  isOn: true,
  subLine: 'person@example.test',
  reasonNote: null,
  reasonActions: [],
  link: null,
}

const KEYS_ACTION = {
  kind: 'open-api-keys',
  label: 'Open API Keys',
  path: '/profile/keys?provider=google',
} as const

const CHOOSE_MODEL_ACTION = {
  kind: 'choose-model',
  label: 'Choose another model',
} as const

const REASON_NOTE = {
  summary: 'Google tools were not offered to this model.',
  detail: 'Besidka does not send Google data to a model that may use it '
    + 'for training.',
  linkLabel: null,
}

async function mountRow(
  row: Partial<ComposerGoogleRow> = {},
  props: { isSaving?: boolean } = {},
  choiceState: 'ready' | 'loading' | 'error' = 'ready',
) {
  return await mountSuspended(ConnectorPickerGoogleRow, {
    props: {
      row: { ...SWITCH_ROW, ...row },
      isSaving: false,
      choiceState,
      ...props,
    },
    global: {
      stubs: {
        ProfileKeysGeminiPaidTier: {
          template: '<div data-testid="gemini-paid-tier-stub" />',
        },
      },
    },
    attachTo: document.body,
  })
}

function byId(
  wrapper: Awaited<ReturnType<typeof mountRow>>,
  id: string,
) {
  return wrapper.find(`[data-testid="${id}"]`)
}

describe('ChatInput/ConnectorPickerGoogleRow', () => {
  it('shows the logo, the name, the sub-line and a labeled switch', async () => {
    const wrapper = await mountRow()
    const toggle = byId(wrapper, 'connector-picker-google-toggle-gmail')

    expect(wrapper.text()).toContain('Gmail')
    expect(byId(wrapper, 'connector-picker-google-subline-gmail').text())
      .toBe('person@example.test')
    expect(wrapper.html()).toContain('google-gmail')
    expect(toggle.attributes('role')).toBe('switch')
    expect(toggle.attributes('aria-label')).toBe('Use Gmail in this chat')
    expect((toggle.element as HTMLInputElement).checked).toBe(true)
    expect(toggle.attributes('disabled')).toBeUndefined()
  })

  it('reflects an off service and emits the service on change', async () => {
    const wrapper = await mountRow({
      isOn: false,
      subLine: 'Off in this chat',
    })
    const toggle = byId(wrapper, 'connector-picker-google-toggle-gmail')

    expect((toggle.element as HTMLInputElement).checked).toBe(false)
    expect(byId(wrapper, 'connector-picker-google-subline-gmail').text())
      .toBe('Off in this chat')

    await toggle.setValue(true)

    expect(wrapper.emitted('toggle')).toEqual([['gmail']])
  })

  describe('while a change is saving', () => {
    it('keeps the switch focusable: aria-disabled and no disabled '
      + 'attribute', async () => {
      const wrapper = await mountRow({}, { isSaving: true })
      const toggle = byId(wrapper, 'connector-picker-google-toggle-gmail')

      expect(toggle.attributes('aria-disabled')).toBe('true')
      expect(toggle.attributes('disabled')).toBeUndefined()
    })

    it('keeps focus on the switch', async () => {
      const wrapper = await mountRow({}, { isSaving: true })
      const toggle = byId(wrapper, 'connector-picker-google-toggle-gmail')

      const input = toggle.element as HTMLInputElement

      input.focus()
      await wrapper.setProps({ isSaving: false })
      await wrapper.setProps({ isSaving: true })

      expect(document.activeElement).toBe(input)
    })

    it('ignores a repeat click and a change event', async () => {
      const wrapper = await mountRow({}, { isSaving: true })
      const toggle = byId(wrapper, 'connector-picker-google-toggle-gmail')

      await toggle.trigger('click')
      await toggle.trigger('change')

      expect(wrapper.emitted('toggle')).toBeUndefined()
      expect((toggle.element as HTMLInputElement).checked).toBe(true)
    })

    it('prevents the native flip of the switch on a click', async () => {
      const wrapper = await mountRow({}, { isSaving: true })
      const toggle = byId(wrapper, 'connector-picker-google-toggle-gmail')
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      })

      toggle.element.dispatchEvent(event)

      expect(event.defaultPrevented).toBe(true)
    })

    it('does not prevent a click when nothing is saving', async () => {
      const wrapper = await mountRow()
      const toggle = byId(wrapper, 'connector-picker-google-toggle-gmail')
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      })

      toggle.element.dispatchEvent(event)

      expect(event.defaultPrevented).toBe(false)
      expect(toggle.attributes('aria-disabled')).toBeUndefined()
    })
  })

  describe('while the stored choice is not known', () => {
    it('shows a loading state, keeps the row height and ignores the '
      + 'switch', async () => {
      const wrapper = await mountRow({}, {}, 'loading')
      const toggle = byId(wrapper, 'connector-picker-google-toggle-gmail')

      expect(toggle.attributes('aria-disabled')).toBe('true')
      expect(toggle.attributes('disabled')).toBeUndefined()
      expect(byId(wrapper, 'connector-picker-google-loading-gmail').exists())
        .toBe(true)
      expect(byId(wrapper, 'connector-picker-google-subline-gmail').text())
        .toBe('Checking this chat')
      expect(wrapper.attributes('aria-busy')).toBe('true')
      expect(wrapper.html()).toContain('max-sm:min-h-11')

      await toggle.trigger('change')

      expect(wrapper.emitted('toggle')).toBeUndefined()
    })

    it('disables the switch without a spinner after a failed read',
      async () => {
        const wrapper = await mountRow({}, {}, 'error')
        const toggle = byId(wrapper, 'connector-picker-google-toggle-gmail')

        expect(toggle.attributes('aria-disabled')).toBe('true')
        expect(byId(wrapper, 'connector-picker-google-loading-gmail')
          .exists()).toBe(false)

        await toggle.trigger('change')

        expect(wrapper.emitted('toggle')).toBeUndefined()
      })

    it('does not block a link row', async () => {
      const wrapper = await mountRow({
        kind: 'link',
        subLine: 'Not connected',
        link: { label: 'Connect', path: '/chats/connectors?panel=google-gmail' },
      }, {}, 'loading')

      expect(byId(wrapper, 'connector-picker-google-loading-gmail').exists())
        .toBe(false)
      expect(byId(wrapper, 'connector-picker-google-link-gmail').exists())
        .toBe(true)
    })
  })

  it('has the phone touch target classes on the row and the link', async () => {
    const wrapper = await mountRow()

    expect(wrapper.html()).toContain('max-sm:min-h-11')

    const linkWrapper = await mountRow({
      kind: 'link',
      subLine: 'Not connected',
      link: { label: 'Connect', path: '/chats/connectors?panel=google-gmail' },
    })

    expect(byId(linkWrapper, 'connector-picker-google-link-gmail')
      .classes()).toContain('min-h-11')
  })

  describe('a model that gets no Google tool', () => {
    it('disables the switch and shows the reason line', async () => {
      const wrapper = await mountRow({
        subLine: 'Not available with this model',
        reasonNote: REASON_NOTE,
      })

      expect(byId(wrapper, 'connector-picker-google-toggle-gmail')
        .attributes('disabled')).toBeDefined()
      expect(byId(wrapper, 'connector-picker-google-subline-gmail').text())
        .toBe('Not available with this model')
    })

    it('hides the reason until the info button is pressed', async () => {
      const wrapper = await mountRow({
        subLine: 'Not available with this model',
        reasonNote: REASON_NOTE,
      })
      const info = byId(wrapper, 'connector-picker-google-info-gmail')
      const note = byId(wrapper, 'connector-picker-google-note-gmail')

      expect(info.attributes('aria-expanded')).toBe('false')
      expect(info.attributes('aria-label'))
        .toBe('Why Gmail is not available with this model')
      expect(info.attributes('aria-controls')).toBe(note.attributes('id'))
      expect(note.attributes('style')).toContain('display: none')

      await info.trigger('click')
      await flushPromises()

      expect(info.attributes('aria-expanded')).toBe('true')
      expect(note.attributes('style') ?? '').not.toContain('display: none')
      expect(note.text()).toBe(REASON_NOTE.detail)

      await info.trigger('click')

      expect(info.attributes('aria-expanded')).toBe('false')
    })

    it('shows no info button without a reason', async () => {
      const wrapper = await mountRow()

      expect(byId(wrapper, 'connector-picker-google-info-gmail').exists())
        .toBe(false)
      expect(byId(wrapper, 'connector-picker-google-note-gmail').exists())
        .toBe(false)
    })

    it('shows the switch unchecked and plainly disabled, even when the '
      + 'chat choice is on', async () => {
      const wrapper = await mountRow({
        isOn: true,
        subLine: 'Not available with this model',
        reasonNote: REASON_NOTE,
      })
      const toggle = byId(wrapper, 'connector-picker-google-toggle-gmail')

      expect((toggle.element as HTMLInputElement).checked).toBe(false)
      expect(toggle.attributes('disabled')).toBeDefined()
      expect(toggle.classes()).not.toContain('opacity-60')
      expect(toggle.attributes('aria-label')).toBe('Use Gmail in this chat')
      expect(wrapper.html()).toContain('cursor-not-allowed')
    })

    it('shows no actions for a note without any', async () => {
      const wrapper = await mountRow({
        subLine: 'Not available with this model',
        reasonNote: REASON_NOTE,
      })

      expect(byId(wrapper, 'connector-picker-google-actions-gmail').exists())
        .toBe(false)
    })

    it('shows only the model button, with no keys link, for a provider '
      + 'the allow-list refuses', async () => {
      const wrapper = await mountRow({
        subLine: 'Not available with this model',
        reasonNote: {
          ...REASON_NOTE,
          detail: 'DeepSeek may use API inputs for training, so Besidka does '
            + 'not send Google data to it. Pick Anthropic, OpenAI, xAI or '
            + 'Gemini on a paid key.',
        },
        reasonActions: [CHOOSE_MODEL_ACTION],
      })

      expect(byId(wrapper, 'connector-picker-google-note-text-gmail').text())
        .toContain('DeepSeek may use API inputs for training')
      expect(byId(wrapper, 'connector-picker-google-action-keys-gmail')
        .exists()).toBe(false)
      expect(byId(wrapper, 'connector-picker-google-action-model-gmail')
        .text()).toBe('Choose another model')
      expect(byId(wrapper, 'gemini-paid-tier-stub').exists()).toBe(false)
    })

    it('shows the keys link and the model button for a gateway model',
      async () => {
        const wrapper = await mountRow({
          subLine: 'Not available with this model',
          reasonNote: REASON_NOTE,
          reasonActions: [KEYS_ACTION, CHOOSE_MODEL_ACTION],
        })
        const link = byId(wrapper, 'connector-picker-google-action-keys-gmail')
        const button = byId(wrapper, 'connector-picker-google-action-model-gmail')

        expect(link.text()).toBe('Open API Keys')
        expect(link.html()).toContain('/profile/keys?provider=google')
        expect(link.classes()).toEqual(expect.arrayContaining([
          'btn',
          'btn-sm',
          'min-h-11',
          'sm:min-h-8',
        ]))
        expect(button.text()).toBe('Choose another model')
        expect(button.classes()).toEqual(expect.arrayContaining([
          'btn',
          'btn-sm',
          'min-h-11',
          'sm:min-h-8',
        ]))
        expect(byId(wrapper, 'gemini-paid-tier-stub').exists()).toBe(false)
      })

    it('emits navigate from the keys link and choose-model from the '
      + 'model button', async () => {
      const wrapper = await mountRow({
        subLine: 'Not available with this model',
        reasonNote: REASON_NOTE,
        reasonActions: [KEYS_ACTION, CHOOSE_MODEL_ACTION],
      })

      await byId(wrapper, 'connector-picker-google-action-keys-gmail')
        .trigger('click')

      expect(wrapper.emitted('navigate')).toHaveLength(1)
      expect(wrapper.emitted('choose-model')).toBeUndefined()

      await byId(wrapper, 'connector-picker-google-action-model-gmail')
        .trigger('click')

      expect(wrapper.emitted('choose-model')).toHaveLength(1)
    })

    it('shows the existing paid-tier confirmation for Gemini and no model '
      + 'button', async () => {
      const wrapper = await mountRow({
        subLine: 'Not available with this model',
        reasonNote: REASON_NOTE,
        reasonActions: [KEYS_ACTION, { kind: 'confirm-paid-tier' }],
      })

      expect(byId(wrapper, 'gemini-paid-tier-stub').exists()).toBe(true)
      expect(byId(wrapper, 'connector-picker-google-action-keys-gmail')
        .exists()).toBe(true)
      expect(byId(wrapper, 'connector-picker-google-action-model-gmail')
        .exists()).toBe(false)
    })

    it('does not emit a toggle for a disabled switch', async () => {
      const wrapper = await mountRow({
        subLine: 'Not available with this model',
        reasonNote: REASON_NOTE,
      })

      await byId(wrapper, 'connector-picker-google-toggle-gmail')
        .trigger('click')

      expect(wrapper.emitted('toggle')).toBeUndefined()
    })
  })

  describe('a service that is not connected or not ready', () => {
    it('shows a Connect link to the panel and no switch', async () => {
      const wrapper = await mountRow({
        kind: 'link',
        isOn: false,
        subLine: 'Not connected',
        link: {
          label: 'Connect',
          path: '/chats/connectors?panel=google-gmail',
        },
      })
      const link = byId(wrapper, 'connector-picker-google-link-gmail')

      expect(link.text()).toBe('Connect')
      expect(link.html()).toContain('/chats/connectors?panel=google-gmail')
      expect(byId(wrapper, 'connector-picker-google-toggle-gmail').exists())
        .toBe(false)
      expect(byId(wrapper, 'connector-picker-google-subline-gmail').text())
        .toBe('Not connected')
    })

    it('links a missing own client to the Google tab', async () => {
      const wrapper = await mountRow({
        kind: 'link',
        subLine: 'Needs your own Google client',
        link: { label: 'Add client', path: '/profile/keys?tab=google' },
      })

      expect(byId(wrapper, 'connector-picker-google-link-gmail').html())
        .toContain('/profile/keys?tab=google')
      expect(byId(wrapper, 'connector-picker-google-subline-gmail').text())
        .toBe('Needs your own Google client')
    })

    it('emits navigate when the link is followed', async () => {
      const wrapper = await mountRow({
        kind: 'link',
        subLine: 'Not connected',
        link: {
          label: 'Connect',
          path: '/chats/connectors?panel=google-gmail',
        },
      })

      await byId(wrapper, 'connector-picker-google-link-gmail')
        .trigger('click')

      expect(wrapper.emitted('navigate')).toHaveLength(1)
    })
  })
})
