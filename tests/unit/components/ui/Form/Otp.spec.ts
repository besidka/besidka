import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import UiFormOtp from '../../../../../app/components/ui/Form/Otp.vue'

describe('ui/Form/Otp', () => {
  it('renders exactly one real input and six decorative spans', async () => {
    const wrapper = await mountSuspended(UiFormOtp)

    expect(wrapper.findAll('input')).toHaveLength(1)
    expect(wrapper.findAll('span')).toHaveLength(6)
  })

  it(
    'places the six spans before the input, since daisyUI sizes and '
    + 'positions each box via `:nth-child()` on the label\'s direct '
    + 'children — an input placed before the spans shifts every '
    + 'nth-child count off by one and breaks the layout',
    async () => {
      const wrapper = await mountSuspended(UiFormOtp)
      const label = wrapper.get('label.otp')
      const children = Array.from(label.element.children)
      const inputIndex = children.findIndex((child) => {
        return child.tagName === 'INPUT'
      })

      expect(inputIndex).toBe(children.length - 1)
      expect(children.slice(0, inputIndex).every((child) => {
        return child.tagName === 'SPAN'
      })).toBe(true)
    },
  )

  it('defaults to numeric six-digit attributes for the totp variant',
    async () => {
      const wrapper = await mountSuspended(UiFormOtp)
      const input = wrapper.get('input')

      expect(input.attributes('type')).toBe('text')
      expect(input.attributes('autocomplete')).toBe('one-time-code')
      expect(input.attributes('inputmode')).toBe('numeric')
      expect(input.attributes('maxlength')).toBe('6')
      expect(input.attributes('pattern')).toBe('[0-9]{6}')
    })

  it('relaxes the pattern/length/inputmode for the backup-code variant',
    async () => {
      const wrapper = await mountSuspended(UiFormOtp, {
        props: { variant: 'backup-code' },
      })
      const input = wrapper.get('input')

      expect(input.attributes('inputmode')).toBe('text')
      expect(input.attributes('maxlength')).toBe('11')
      expect(input.attributes('pattern')).toBe('[A-Za-z0-9]{5}-[A-Za-z0-9]{5}')
      expect(wrapper.findAll('input')).toHaveLength(1)
      expect(wrapper.findAll('span')).toHaveLength(0)
    })

  it(
    'renders the backup-code variant as a plain input instead of the '
    + 'daisyUI multi-cell otp box, since that box only supports up to 8 '
    + 'cells and would clip an 11-character backup code',
    async () => {
      const wrapper = await mountSuspended(UiFormOtp, {
        props: { variant: 'backup-code' },
      })

      expect(wrapper.find('label.otp').exists()).toBe(false)
      expect(wrapper.get('input').element.tagName).toBe('INPUT')
    },
  )

  it('keeps the daisyUI six-cell otp box for the totp variant', async () => {
    const wrapper = await mountSuspended(UiFormOtp, {
      props: { variant: 'totp' },
    })

    expect(wrapper.find('label.otp').exists()).toBe(true)
    expect(wrapper.findAll('span')).toHaveLength(6)
  })

  it('strips non-digit characters for the totp variant', async () => {
    const wrapper = await mountSuspended(UiFormOtp)
    const input = wrapper.get('input')

    await input.setValue('1a2b3c4d5e6f7g')

    expect((input.element as HTMLInputElement).value).toBe('123456')
  })

  it('emits complete once six digits are entered', async () => {
    const wrapper = await mountSuspended(UiFormOtp)
    const input = wrapper.get('input')

    await input.setValue('12345')
    expect(wrapper.emitted('complete')).toBeUndefined()

    await input.setValue('123456')
    expect(wrapper.emitted('complete')).toEqual([['123456']])
  })

  it('emits complete once the backup-code length is reached', async () => {
    const wrapper = await mountSuspended(UiFormOtp, {
      props: { variant: 'backup-code' },
    })
    const input = wrapper.get('input')

    await input.setValue('abcde-fghi')
    expect(wrapper.emitted('complete')).toBeUndefined()

    await input.setValue('abcde-fghij')
    expect(wrapper.emitted('complete')).toEqual([['abcde-fghij']])
  })
})
