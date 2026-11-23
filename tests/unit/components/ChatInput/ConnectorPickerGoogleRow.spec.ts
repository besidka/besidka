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
  link: null,
}

const REASON_NOTE = {
  summary: 'Google tools were not offered to this model.',
  detail: 'Besidka does not send Google data to a model that may use it '
    + 'for training.',
  linkLabel: null,
}

async function mountRow(
  row: Partial<ComposerGoogleRow> = {},
  props: { isSaving?: boolean } = {},
) {
  return await mountSuspended(ConnectorPickerGoogleRow, {
    props: { row: { ...SWITCH_ROW, ...row }, isSaving: false, ...props },
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

  it('disables the switch while a change is saving', async () => {
    const wrapper = await mountRow({}, { isSaving: true })

    expect(byId(wrapper, 'connector-picker-google-toggle-gmail')
      .attributes('disabled')).toBeDefined()
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
