import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { ConfirmOptions } from '../../../app/types/confirmation.d'
import ConfirmationComponent from '../../../app/components/ui/Confirmation.vue'
import {
  useConfirmation,
  useConfirm,
  resetConfirmationState,
} from '../../../app/composables/confirmation'

function makeOptions(overrides?: Partial<ConfirmOptions>): ConfirmOptions {
  return {
    text: 'Confirm',
    alert: false,
    actions: ['Confirm'],
    ...overrides,
  }
}

describe('Confirmation.vue', () => {
  beforeEach(() => {
    resetConfirmationState()
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(() => {})
    vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(() => {})
  })

  it('renders no title, no action button, and Close label when no confirmation is pending', async () => {
    const wrapper = await mountSuspended(ConfirmationComponent)

    expect(wrapper.find('h3').exists()).toBe(false)
    expect(wrapper.find('[data-testid="confirmation-decline"]').text()).toBe('Close')
    expect(wrapper.find('[data-testid="confirmation-action-0"]').exists()).toBe(false)
  })

  it('renders title text from confirmation state', async () => {
    useConfirmation().value = makeOptions({ text: 'Are you sure?' })

    const wrapper = await mountSuspended(ConfirmationComponent)

    expect(wrapper.find('h3').text()).toBe('Are you sure?')
  })

  it('renders subtitle when provided, hides generic alert text', async () => {
    useConfirmation().value = makeOptions({
      subtitle: 'This will permanently remove the item.',
    })

    const wrapper = await mountSuspended(ConfirmationComponent)

    expect(wrapper.find('p').text()).toBe('This will permanently remove the item.')
    expect(wrapper.html()).not.toContain('Be careful')
  })

  it('renders generic alert text when alert is true and no subtitle', async () => {
    useConfirmation().value = makeOptions({ alert: true })

    const wrapper = await mountSuspended(ConfirmationComponent)

    expect(wrapper.find('p').text()).toContain('Be careful')
  })

  it('renders subtitle instead of alert text when both are set', async () => {
    useConfirmation().value = makeOptions({
      alert: true,
      subtitle: 'Custom warning.',
    })

    const wrapper = await mountSuspended(ConfirmationComponent)

    expect(wrapper.find('p').text()).toBe('Custom warning.')
    expect(wrapper.html()).not.toContain('Be careful')
  })

  it('adds text-center to title when alert is false', async () => {
    useConfirmation().value = makeOptions({ alert: false })

    const wrapper = await mountSuspended(ConfirmationComponent)

    expect(wrapper.find('h3').classes()).toContain('text-center')
  })

  it('removes text-center from title when alert is true', async () => {
    useConfirmation().value = makeOptions({ alert: true })

    const wrapper = await mountSuspended(ConfirmationComponent)

    expect(wrapper.find('h3').classes()).not.toContain('text-center')
  })

  it('renders single action as a plain button, no split container', async () => {
    useConfirmation().value = makeOptions({ actions: ['Delete'] })

    const wrapper = await mountSuspended(ConfirmationComponent)

    expect(wrapper.find('[data-testid="confirmation-action-0"]').text()).toBe('Delete')
    expect(wrapper.find('[data-testid="confirmation-actions-split"]').exists()).toBe(false)
  })

  it('shows default Decline label from prop when state has no labelDecline', async () => {
    useConfirmation().value = makeOptions()

    const wrapper = await mountSuspended(ConfirmationComponent)

    expect(wrapper.find('[data-testid="confirmation-decline"]').text()).toBe('Decline')
  })

  it('shows labelDecline from state, overriding prop default', async () => {
    useConfirmation().value = makeOptions({ labelDecline: 'Close' })

    const wrapper = await mountSuspended(ConfirmationComponent)

    expect(wrapper.find('[data-testid="confirmation-decline"]').text()).toBe('Close')
  })

  it('uses prop labelDecline as fallback when state has no labelDecline', async () => {
    useConfirmation().value = makeOptions()

    const wrapper = await mountSuspended(ConfirmationComponent, {
      props: { labelDecline: 'No' },
    })

    expect(wrapper.find('[data-testid="confirmation-decline"]').text()).toBe('No')
  })

  it('resolves with result when action button is clicked', async () => {
    const promise = useConfirm({ text: 'Confirm', actions: ['OK'] })
    const wrapper = await mountSuspended(ConfirmationComponent)

    await wrapper.find('[data-testid="confirmation-action-0"]').trigger('click')

    expect(await promise).toEqual({ label: 'OK', index: 0 })
  })

  it('resolves with null when decline button is clicked', async () => {
    const promise = useConfirm({ text: 'Confirm', actions: ['OK'] })
    const wrapper = await mountSuspended(ConfirmationComponent)

    await wrapper.find('[data-testid="confirmation-decline"]').trigger('click')

    expect(await promise).toBeNull()
  })

  it('clears state after action is confirmed', async () => {
    const state = useConfirmation()
    const promise = useConfirm({ text: 'Confirm', actions: ['OK'] })
    const wrapper = await mountSuspended(ConfirmationComponent)

    await wrapper.find('[data-testid="confirmation-action-0"]').trigger('click')
    await promise

    expect(state.value).toBeNull()
  })

  it('renders two actions with split container and primary + dropdown', async () => {
    useConfirmation().value = makeOptions({
      actions: ['Open', 'Open always'],
    })

    const wrapper = await mountSuspended(ConfirmationComponent)

    expect(wrapper.find('[data-testid="confirmation-actions-split"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="confirmation-action-0"]').text()).toBe('Open')
    expect(wrapper.find('[data-testid="confirmation-action-1"]').text()).toBe('Open always')
  })

  it('resolves with index 1 when dropdown action is clicked', async () => {
    const promise = useConfirm({
      text: 'Open link?',
      actions: ['Open', 'Open always'],
    })
    const wrapper = await mountSuspended(ConfirmationComponent)

    await wrapper.find('[data-testid="confirmation-action-1"]').trigger('click')

    expect(await promise).toEqual({ label: 'Open always', index: 1 })
  })

  it('shows next queued confirmation after first is resolved via click', async () => {
    const promise1 = useConfirm({ text: 'First', actions: ['OK'] })
    useConfirm({ text: 'Second', actions: ['OK'] })

    const wrapper = await mountSuspended(ConfirmationComponent)

    await wrapper.find('[data-testid="confirmation-action-0"]').trigger('click')
    await promise1
    await nextTick()

    expect(useConfirmation().value?.text).toBe('Second')
  })

  it('renders all custom options correctly', async () => {
    const promise = useConfirm({
      text: 'Open external site?',
      alert: false,
      subtitle: 'You are about to leave the application.',
      actions: ['Open', 'Open always'],
      labelDecline: 'Close',
    })

    const wrapper = await mountSuspended(ConfirmationComponent)

    expect(wrapper.find('h3').text()).toBe('Open external site?')
    expect(wrapper.find('h3').classes()).toContain('text-center')
    expect(wrapper.find('p').text()).toBe('You are about to leave the application.')
    expect(wrapper.html()).not.toContain('Be careful')
    expect(wrapper.find('[data-testid="confirmation-decline"]').text()).toBe('Close')
    expect(wrapper.find('[data-testid="confirmation-actions-split"]').exists()).toBe(true)

    await wrapper.find('[data-testid="confirmation-action-0"]').trigger('click')

    expect(await promise).toEqual({ label: 'Open', index: 0 })
  })
})
