import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import StepIcon from '../../../../../app/components/Chat/Reasoning/StepIcon.vue'
import type { ReasoningStepIcon } from '../../../../../app/utils/reasoning-step-icons'

async function mountIcon(icon: ReasoningStepIcon | null) {
  return await mountSuspended(StepIcon, { props: { icon } })
}

describe('Chat/Reasoning/StepIcon', () => {
  it('renders nothing without an icon', async () => {
    const wrapper = await mountIcon(null)

    expect(wrapper.find('[data-testid="reasoning-step-icon"]').exists())
      .toBe(false)
  })

  it('is decorative for every kind of icon', async () => {
    const icons: ReasoningStepIcon[] = [
      { kind: 'iconify', name: 'lucide:sparkles' },
      { kind: 'provider', providerId: 'brave' },
      { kind: 'besidka' },
      { kind: 'connector', connectorId: 'abc', letter: 'N' },
    ]

    for (const icon of icons) {
      const wrapper = await mountIcon(icon)
      const root = wrapper.get('[data-testid="reasoning-step-icon"]')

      expect(root.attributes('aria-hidden')).toBe('true')
      expect(root.attributes('data-kind')).toBe(icon.kind)
      expect(root.text()).toBe('')
    }
  })

  it('loads a connector icon only from the Besidka route, never remote', async () => {
    const wrapper = await mountIcon({
      kind: 'connector',
      connectorId: 'abc/123',
      letter: 'N',
    })
    const image = wrapper.get('[data-testid="reasoning-step-icon-image"]')

    expect(image.attributes('src')).toBe('/api/v1/connectors/abc%2F123/icon')
    expect(image.attributes('alt')).toBe('')
    expect(image.attributes('referrerpolicy')).toBe('no-referrer')
    expect(wrapper.html()).not.toContain('http')
  })

  it('falls back to the letter avatar when the image cannot load', async () => {
    const wrapper = await mountIcon({
      kind: 'connector',
      connectorId: 'abc',
      letter: 'N',
    })

    await wrapper.get('[data-testid="reasoning-step-icon-image"]')
      .trigger('error')

    expect(wrapper.find('[data-testid="reasoning-step-icon-image"]').exists())
      .toBe(false)

    const letter = wrapper.get('[data-testid="reasoning-step-icon-letter"]')

    expect(letter.text()).toBe('N')
    expect(wrapper.get('[data-testid="reasoning-step-icon"]')
      .attributes('aria-hidden')).toBe('true')
  })

  it.each([
    'logos:google-drive',
    'logos:google-gmail',
    'logos:google-calendar',
  ])('keeps the aspect ratio of the %s mark in its square box', async (name) => {
    const wrapper = await mountIcon({ kind: 'iconify', name })
    const classes = wrapper.get('[data-testid="reasoning-step-icon"]')
      .get('.size-full')
      .classes()

    expect(classes).toContain('bg-contain!')
    expect(classes).toContain('bg-center!')
  })

  it('tries the image again for another connector', async () => {
    const wrapper = await mountIcon({
      kind: 'connector',
      connectorId: 'abc',
      letter: 'N',
    })

    await wrapper.get('[data-testid="reasoning-step-icon-image"]')
      .trigger('error')
    await wrapper.setProps({
      icon: { kind: 'connector', connectorId: 'def', letter: 'L' },
    })

    expect(wrapper.get('[data-testid="reasoning-step-icon-image"]')
      .attributes('src')).toBe('/api/v1/connectors/def/icon')
  })
})
