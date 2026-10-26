import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserSetting } from '../../../../app/composables/user-setting'
import PreferencesPage from '../../../../app/pages/profile/preferences.vue'

const mocks = vi.hoisted(() => ({
  errorMessage: vi.fn(),
  fetch: vi.fn(),
  isPushSupported: true,
  isPushStateKnown: true,
  pushPermission: 'default' as NotificationPermission,
  isPushSubscribed: false,
  disablePush: vi.fn(async () => undefined),
  requestEnablePush: vi.fn(async () => undefined),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useErrorMessage', () => mocks.errorMessage)

mockNuxtImport('usePushNotifications', () => {
  return () => ({
    isSupported: {
      get value() {
        return mocks.isPushSupported
      },
    },
    isStateKnown: {
      get value() {
        return mocks.isPushStateKnown
      },
    },
    permission: {
      get value() {
        return mocks.pushPermission
      },
    },
    isSubscribed: {
      get value() {
        return mocks.isPushSubscribed
      },
    },
  })
})

mockNuxtImport('useNotificationPrompt', () => {
  return () => ({
    disable: mocks.disablePush,
    requestEnable: mocks.requestEnablePush,
  })
})

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
    mocks.isPushSupported = true
    mocks.isPushStateKnown = true
    mocks.pushPermission = 'default'
    mocks.isPushSubscribed = false
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
    expect(wrapper.find('input[name="default-reasoning-level"]').exists())
      .toBe(false)
    expect(wrapper.find(
      '[data-testid="preferences-reasoning-expanded-toggle"]',
    ).exists()).toBe(false)

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

  describe('notifications section', () => {
    const pushToggle = '[data-testid="preferences-push-toggle"]'
    const pushStatus = '[data-testid="preferences-push-status"]'

    function pushInput(wrapper: Awaited<ReturnType<typeof mountPage>>) {
      return wrapper.get(pushToggle).element as HTMLInputElement
    }

    it('renders the Notifications card above Reasoning', async () => {
      await loadSettings()

      const wrapper = await mountPage()
      const headings = wrapper.findAll('h2')
        .map(heading => heading.text())
        .filter(text => text === 'Notifications' || text === 'Reasoning')

      expect(headings).toEqual(['Notifications', 'Reasoning'])
      expect(wrapper.text()).toContain('Push notifications')
      expect(wrapper.text()).toContain('a response finishes')
      expect(wrapper.text()).toContain('a shared chat')
      expect(wrapper.text()).toContain('a shared chat you branched')
      expect(wrapper.text()).toContain('never include your messages')
    })

    it('keeps the skeleton and no toggle or status until the push state is '
      + 'known', async () => {
      mocks.isPushStateKnown = false
      mocks.pushPermission = 'denied'
      await loadSettings()

      const wrapper = await mountPage()
      await flushPromises()

      expect(wrapper.find('[data-testid="preferences-push-skeleton"]')
        .exists()).toBe(true)
      expect(wrapper.find(pushToggle).exists()).toBe(false)
      expect(wrapper.get(pushStatus).text()).toBe('')
    })

    it('replaces the skeleton with an accessible toggle once known',
      async () => {
        await loadSettings()

        const wrapper = await mountPage()
        await flushPromises()

        expect(wrapper.find('[data-testid="preferences-push-skeleton"]')
          .exists()).toBe(false)
        expect(wrapper.get(pushToggle).attributes('aria-labelledby'))
          .toBe('push-notifications-title')
        expect(wrapper.get(pushToggle).attributes('aria-describedby'))
          .toBe('push-notifications-description')
      })

    it('reflects the granted and subscribed state', async () => {
      mocks.pushPermission = 'granted'
      mocks.isPushSubscribed = true
      await loadSettings()

      const wrapper = await mountPage()

      expect(pushInput(wrapper).checked).toBe(true)
      expect(pushInput(wrapper).disabled).toBe(false)
      expect(wrapper.get(pushStatus).text()).toBe('')
    })

    it('shows the toggle off when granted but not subscribed', async () => {
      mocks.pushPermission = 'granted'
      mocks.isPushSubscribed = false
      await loadSettings()

      const wrapper = await mountPage()

      expect(pushInput(wrapper).checked).toBe(false)
    })

    it('opens the disclosed prompt instead of enabling directly',
      async () => {
        await loadSettings()

        const wrapper = await mountPage()

        await wrapper.get(pushToggle).trigger('click')
        await flushPromises()

        expect(mocks.requestEnablePush).toHaveBeenCalledTimes(1)
        expect(mocks.disablePush).not.toHaveBeenCalled()
        expect(pushInput(wrapper).checked).toBe(false)
      })

    it('disables push for this browser when it is enabled', async () => {
      mocks.pushPermission = 'granted'
      mocks.isPushSubscribed = true
      await loadSettings()

      const wrapper = await mountPage()

      await wrapper.get(pushToggle).trigger('click')
      await flushPromises()

      expect(mocks.disablePush).toHaveBeenCalledTimes(1)
      expect(mocks.requestEnablePush).not.toHaveBeenCalled()
    })

    it('disables the toggle and explains when notifications are blocked',
      async () => {
        mocks.pushPermission = 'denied'
        await loadSettings()

        const wrapper = await mountPage()

        expect(pushInput(wrapper).disabled).toBe(true)
        expect(wrapper.get(pushStatus).text())
          .toContain('Blocked in browser settings')
      })

    it('disables the toggle and explains when push is unsupported',
      async () => {
        mocks.isPushSupported = false
        await loadSettings()

        const wrapper = await mountPage()

        expect(pushInput(wrapper).disabled).toBe(true)
        expect(wrapper.get(pushStatus).text())
          .toContain('doesn\'t support push notifications')
      })

    it('does not wait for user settings to render the toggle', async () => {
      const wrapper = await mountPage()
      await flushPromises()

      expect(wrapper.find(pushToggle).exists()).toBe(true)
      expect(wrapper.find('[data-testid="preferences-reasoning-skeleton"]')
        .exists()).toBe(true)
    })
  })
})
