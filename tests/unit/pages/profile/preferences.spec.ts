import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserSetting } from '../../../../app/composables/user-setting'
import PreferencesPage from '../../../../app/pages/profile/preferences.vue'

const mocks = vi.hoisted(() => ({
  errorMessage: vi.fn(),
  fetch: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useErrorMessage', () => mocks.errorMessage)

enableAutoUnmount(afterEach)

interface ServerSettings {
  defaultReasoningLevel: string | null
  reasoningExpanded: boolean
  reasoningAutoHide: boolean
}

const productDefaultNote = '[data-testid="default-reasoning-product-default"]'
const productDefaultLabel = 'Off'

function patchBodies() {
  return mocks.fetch.mock.calls
    .filter(([, options]) => {
      return options?.method === 'PATCH'
    })
    .map(([, options]) => {
      return options.body
    })
}

async function loadSettings(overrides: Partial<ServerSettings> = {}) {
  mocks.fetch.mockResolvedValueOnce({
    defaultReasoningLevel: null,
    reasoningExpanded: false,
    reasoningAutoHide: true,
    ...overrides,
  })

  await useUserSetting().syncForUser('user-1')
}

async function mountPage() {
  return await mountSuspended(PreferencesPage)
}

function checkedLevels(wrapper: Awaited<ReturnType<typeof mountPage>>) {
  return wrapper
    .findAll('input[name="default-reasoning-level"]')
    .filter((input) => {
      return (input.element as HTMLInputElement).checked
    })
    .map((input) => {
      return input.attributes('aria-label')
    })
}

describe('profile preferences page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mocks.fetch.mockReset()
    useUserSetting().clearUserContext()
  })

  afterEach(() => {
    useUserSetting().clearUserContext()
  })

  it('renders the heading and the reasoning section', async () => {
    await loadSettings()

    const wrapper = await mountPage()

    expect(wrapper.get('h1').text()).toBe('Preferences')
    expect(wrapper.text()).toContain('Reasoning')
    expect(wrapper.text()).toContain('Default reasoning effort')
    expect(wrapper.text()).toContain(
      'Used for new chats. Models that can\'t use this level pick the '
      + 'closest one they support.',
    )
    expect(wrapper.text()).toContain('Show reasoning steps expanded')
    expect(wrapper.text()).toContain('Auto-hide when done')
  })

  it('renders Off, Low, Medium and High in that order', async () => {
    await loadSettings()

    const wrapper = await mountPage()
    const options = wrapper.findAll('input[name="default-reasoning-level"]')

    expect(options.map(option => option.attributes('aria-label')))
      .toEqual(['Off', 'Low', 'Medium', 'High'])
    expect(wrapper.get('[role="radiogroup"]').attributes('aria-labelledby'))
      .toBe('default-reasoning-title')
  })

  it('shows skeletons instead of controls until settings load', async () => {
    const wrapper = await mountPage()

    expect(wrapper.find('[data-testid="preferences-reasoning-skeleton"]')
      .exists()).toBe(true)
    expect(wrapper.find('[data-testid="preferences-expanded-skeleton"]')
      .exists()).toBe(true)
    expect(wrapper.find('[data-testid="preferences-auto-hide-skeleton"]')
      .exists()).toBe(true)
    expect(wrapper.find('input').exists()).toBe(false)

    await loadSettings({ defaultReasoningLevel: 'high' })
    await flushPromises()

    expect(wrapper.find('[data-testid="preferences-reasoning-skeleton"]')
      .exists()).toBe(false)
    expect(checkedLevels(wrapper)).toEqual(['High'])
  })

  it('selects the saved default level', async () => {
    await loadSettings({ defaultReasoningLevel: 'medium' })

    const wrapper = await mountPage()

    expect(checkedLevels(wrapper)).toEqual(['Medium'])
  })

  it('selects the product default and labels it when no default is saved',
    async () => {
      await loadSettings({ defaultReasoningLevel: null })

      const wrapper = await mountPage()

      expect(checkedLevels(wrapper)).toEqual([
        productDefaultLabel,
      ])
      expect(wrapper.get(productDefaultNote).text())
        .toBe('Product default')
    })

  it('selects the level new chats would use when saving it failed to sync',
    async () => {
      localStorage.setItem('settings_reasoning_level', 'high')
      mocks.fetch.mockResolvedValueOnce({
        defaultReasoningLevel: null,
        reasoningExpanded: false,
        reasoningAutoHide: true,
      })
      mocks.fetch.mockRejectedValueOnce(new Error('Save failed'))

      await useUserSetting().syncForUser('user-1')

      const wrapper = await mountPage()

      expect(checkedLevels(wrapper)).toEqual(['High'])
      expect(wrapper.get(productDefaultNote).text())
        .toBe('Product default')
    })

  it('hides the product default note once a default is saved', async () => {
    await loadSettings({ defaultReasoningLevel: 'low' })

    const wrapper = await mountPage()

    expect(wrapper.get(productDefaultNote).text()).toBe('')
  })

  it('drops the product default note after the user picks a level',
    async () => {
      await loadSettings({ defaultReasoningLevel: null })
      mocks.fetch.mockResolvedValueOnce({ defaultReasoningLevel: 'medium' })

      const wrapper = await mountPage()

      await wrapper.get('[data-testid="default-reasoning-level-medium"]')
        .trigger('click')
      await flushPromises()

      expect(wrapper.get(productDefaultNote).text()).toBe('')
      expect(checkedLevels(wrapper)).toEqual(['Medium'])
    })

  it('saves the picked level to the server', async () => {
    await loadSettings({ defaultReasoningLevel: 'low' })
    mocks.fetch.mockResolvedValueOnce({ defaultReasoningLevel: 'high' })

    const wrapper = await mountPage()

    await wrapper.get('[data-testid="default-reasoning-level-high"]')
      .trigger('click')
    await flushPromises()

    expect(patchBodies()).toEqual([{ defaultReasoningLevel: 'high' }])
    expect(checkedLevels(wrapper)).toEqual(['High'])
    expect(localStorage.getItem('settings_reasoning_level')).toBeNull()
  })

  it('does not save when the current level is clicked again', async () => {
    await loadSettings({ defaultReasoningLevel: 'low' })

    const wrapper = await mountPage()

    await wrapper.get('[data-testid="default-reasoning-level-low"]')
      .trigger('click')
    await flushPromises()

    expect(patchBodies()).toEqual([])
  })

  it('saves an explicit Off when no default was saved yet', async () => {
    await loadSettings({ defaultReasoningLevel: null })
    mocks.fetch.mockResolvedValueOnce({ defaultReasoningLevel: 'off' })

    const wrapper = await mountPage()

    await wrapper.get('[data-testid="default-reasoning-level-off"]')
      .trigger('click')
    await flushPromises()

    expect(patchBodies()).toEqual([{ defaultReasoningLevel: 'off' }])
  })

  it('reverts the selection and reports an error when saving fails',
    async () => {
      await loadSettings({ defaultReasoningLevel: 'low' })
      mocks.fetch.mockRejectedValueOnce(new Error('Save failed'))

      const wrapper = await mountPage()

      await wrapper.get('[data-testid="default-reasoning-level-high"]')
        .trigger('click')
      await flushPromises()

      expect(checkedLevels(wrapper)).toEqual(['Low'])
      expect(mocks.errorMessage).toHaveBeenCalledTimes(1)
    })

  it('reflects the expanded and auto-hide settings', async () => {
    await loadSettings({
      reasoningExpanded: true,
      reasoningAutoHide: false,
    })

    const wrapper = await mountPage()
    const expanded = wrapper.get(
      '[data-testid="preferences-reasoning-expanded-toggle"]',
    )
    const autoHide = wrapper.get(
      '[data-testid="preferences-reasoning-auto-hide-toggle"]',
    )

    expect((expanded.element as HTMLInputElement).checked).toBe(true)
    expect((autoHide.element as HTMLInputElement).checked).toBe(false)
    expect((autoHide.element as HTMLInputElement).disabled).toBe(false)
  })

  it('disables auto-hide while reasoning steps are not expanded',
    async () => {
      await loadSettings({ reasoningExpanded: false })

      const wrapper = await mountPage()
      const autoHide = wrapper.get(
        '[data-testid="preferences-reasoning-auto-hide-toggle"]',
      )

      expect((autoHide.element as HTMLInputElement).disabled).toBe(true)
    })

  it('saves the expanded toggle through the shared setter', async () => {
    await loadSettings({ reasoningExpanded: false })
    mocks.fetch.mockResolvedValueOnce({ reasoningExpanded: true })

    const wrapper = await mountPage()

    await wrapper
      .get('[data-testid="preferences-reasoning-expanded-toggle"]')
      .setValue(true)
    await flushPromises()

    expect(patchBodies()).toEqual([{ reasoningExpanded: true }])
    expect(useUserSetting().reasoningExpanded.value).toBe(true)
  })

  it('saves the auto-hide toggle through the shared setter', async () => {
    await loadSettings({
      reasoningExpanded: true,
      reasoningAutoHide: true,
    })
    mocks.fetch.mockResolvedValueOnce({ reasoningAutoHide: false })

    const wrapper = await mountPage()

    await wrapper
      .get('[data-testid="preferences-reasoning-auto-hide-toggle"]')
      .setValue(false)
    await flushPromises()

    expect(patchBodies()).toEqual([{ reasoningAutoHide: false }])
    expect(useUserSetting().reasoningAutoHide.value).toBe(false)
  })
})
