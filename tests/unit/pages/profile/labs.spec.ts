import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import LabsPage from '../../../../app/pages/profile/labs.vue'
import ProfileLayout from '../../../../app/layouts/profile.vue'

const mocks = vi.hoisted(() => ({
  fetchData: vi.fn(),
  refresh: vi.fn(),
  fetch: vi.fn(),
  error: vi.fn(),
  refreshFeatures: vi.fn(),
  keyStatus: vi.fn(),
}))

mockNuxtImport('useFetch', () => mocks.fetchData)
mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useErrorMessage', () => mocks.error)
mockNuxtImport('useFeatures', () => {
  return () => ({ refreshFeatures: mocks.refreshFeatures })
})
mockNuxtImport('useUserKeys', () => {
  return () => ({ keyStatusForProvider: mocks.keyStatus })
})

function createFeature(overrides: Record<string, unknown> = {}) {
  return {
    key: 'artifacts',
    title: 'Artifacts',
    description: 'Interactive documents and apps rendered next to the chat.',
    stage: 'internal',
    spend: 'none',
    optIn: 'none',
    requires: { keyKinds: [] },
    parent: null,
    optedIn: true,
    active: true,
    ...overrides,
  }
}

const llmBridge = createFeature({
  key: 'artifacts.llm-bridge',
  title: 'Artifacts that call a model',
  description: 'Artifacts that ask a model questions with your API keys.',
  spend: 'foreground',
  optIn: 'required',
  requires: { keyKinds: ['provider'] },
  parent: 'artifacts',
  optedIn: false,
  active: false,
})

interface MountOptions {
  features?: Array<Record<string, unknown>>
  objectedToExperiments?: boolean
  status?: string
  error?: unknown
  data?: unknown
}

async function mountPage(options: MountOptions = {}) {
  const data = options.data === undefined
    ? {
      features: options.features ?? [createFeature(), llmBridge],
      objectedToExperiments: options.objectedToExperiments ?? false,
    }
    : options.data

  mocks.fetchData.mockReturnValue({
    data: ref(data),
    status: ref(options.status ?? 'success'),
    error: ref(options.error ?? null),
    refresh: mocks.refresh,
  })

  return mountSuspended(LabsPage)
}

async function flushPromises() {
  for (let tick = 0; tick < 8; tick += 1) {
    await Promise.resolve()
  }
}

describe('profile labs page', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useSeoMeta', vi.fn())
    mocks.fetchData.mockReset()
    mocks.refresh.mockReset().mockResolvedValue(undefined)
    mocks.fetch.mockReset().mockResolvedValue({})
    mocks.error.mockReset()
    mocks.refreshFeatures.mockReset().mockResolvedValue(undefined)
    mocks.keyStatus.mockReset().mockReturnValue('saved')
  })

  it('renders accessible features grouped under their parent', async () => {
    const wrapper = await mountPage()
    const card = wrapper.get('[data-testid="labs-feature-artifacts"]')

    expect(card.text()).toContain('Artifacts')
    expect(card.text()).toContain('Internal')
    expect(card.find('[data-testid="labs-row-artifacts.llm-bridge"]')
      .exists()).toBe(true)
    expect(wrapper.find('[data-testid="labs-feature-artifacts.llm-bridge"]')
      .exists()).toBe(false)
  })

  it('shows a toggle on every feature: opt-out on, opt-in off by default',
    async () => {
      const wrapper = await mountPage()
      const optInToggle = wrapper.get(
        '[data-testid="labs-toggle-artifacts.llm-bridge"]',
      )
      const optOutToggle = wrapper.get('[data-testid="labs-toggle-artifacts"]')

      expect((optInToggle.element as HTMLInputElement).checked).toBe(false)
      expect((optOutToggle.element as HTMLInputElement).checked).toBe(true)
      expect(wrapper.get('[data-testid="labs-spend-artifacts.llm-bridge"]')
        .text()).toBe('Uses your API keys')
      expect(wrapper.find('[data-testid="labs-spend-artifacts"]').exists())
        .toBe(false)
    })

  it('shows the feature name on every row, including the first of a section',
    async () => {
      const wrapper = await mountPage()
      const firstRowTitle = wrapper.get('[id="labs-title-artifacts"]')

      expect(firstRowTitle.text()).toBe('Artifacts')
      expect(firstRowTitle.classes()).not.toContain('sr-only')
      expect(wrapper.get('[id="labs-title-artifacts.llm-bridge"]').text())
        .toBe('Artifacts that call a model')
    })

  it('saves an opt-out when an enabled feature is switched off', async () => {
    const wrapper = await mountPage()

    await wrapper.get('[data-testid="labs-toggle-artifacts"]').setValue(false)
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/profiles/features/artifacts/opt-in',
      { method: 'POST', body: { optedIn: false } },
    )
    expect(mocks.refreshFeatures).toHaveBeenCalled()
  })

  it('saves an opt-in, then refreshes the page data and the features state',
    async () => {
      const wrapper = await mountPage()

      await wrapper.get('[data-testid="labs-toggle-artifacts.llm-bridge"]')
        .setValue(true)
      await flushPromises()

      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/profiles/features/artifacts.llm-bridge/opt-in',
        { method: 'POST', body: { optedIn: true } },
      )
      expect(mocks.refresh).toHaveBeenCalled()
      expect(mocks.refreshFeatures).toHaveBeenCalled()
      expect(mocks.error).not.toHaveBeenCalled()
    })

  it('keeps the toggle on after a save that refreshes real data', async () => {
    const data = ref({
      features: [createFeature(), llmBridge],
      objectedToExperiments: false,
    })

    mocks.refresh.mockImplementation(async () => {
      data.value = {
        features: [createFeature(), { ...llmBridge, optedIn: true }],
        objectedToExperiments: false,
      }
    })
    mocks.fetchData.mockReturnValue({
      data,
      status: ref('success'),
      error: ref(null),
      refresh: mocks.refresh,
    })

    const wrapper = await mountSuspended(LabsPage)
    const selector = '[data-testid="labs-toggle-artifacts.llm-bridge"]'

    await wrapper.get(selector).setValue(true)
    await flushPromises()
    await nextTick()

    expect((wrapper.get(selector).element as HTMLInputElement).checked)
      .toBe(true)
  })

  it('ignores a second change while saving and restores the checkbox',
    async () => {
      mocks.fetch.mockImplementation(() => {
        return new Promise(() => {})
      })

      const wrapper = await mountPage()
      const selector = '[data-testid="labs-toggle-artifacts.llm-bridge"]'

      await wrapper.get(selector).setValue(true)
      await flushPromises()
      await wrapper.get(selector).setValue(false)
      await flushPromises()

      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      expect((wrapper.get(selector).element as HTMLInputElement).checked)
        .toBe(true)
    })

  it('hints that a child works only once its switched-off parent is on',
    async () => {
      const wrapper = await mountPage({
        features: [
          createFeature({ optedIn: false, active: false }),
          createFeature({
            key: 'artifacts.react',
            title: 'React artifacts',
            parent: 'artifacts',
            active: false,
          }),
        ],
      })

      expect(wrapper.get('[data-testid="labs-parent-hint-artifacts.react"]')
        .text()).toContain('Works once Artifacts is on')
    })

  it('hints that a child works only once its opt-in parent is on',
    async () => {
      const wrapper = await mountPage({
        features: [
          createFeature({
            key: 'research.custom',
            title: 'Custom research',
            spend: 'foreground',
            optIn: 'required',
            optedIn: false,
          }),
          createFeature({
            key: 'research.custom.max',
            title: 'Custom research, maximum depth',
            spend: 'foreground',
            optIn: 'required',
            parent: 'research.custom',
          }),
        ],
      })

      expect(wrapper.get(
        '[data-testid="labs-parent-hint-research.custom.max"]',
      ).text()).toContain('Works once Custom research is on')
    })

  it('rolls the toggle back and shows the error when saving fails',
    async () => {
      let rejectSave: (reason: unknown) => void = () => {}

      mocks.fetch.mockImplementation(() => {
        return new Promise((_resolve, reject) => {
          rejectSave = reject
        })
      })

      const wrapper = await mountPage()
      const selector = '[data-testid="labs-toggle-artifacts.llm-bridge"]'

      await wrapper.get(selector).setValue(true)
      await flushPromises()

      const pendingToggle = wrapper.get(selector).element as HTMLInputElement

      expect(pendingToggle.checked).toBe(true)
      expect(wrapper.get(selector).attributes('aria-busy')).toBe('true')

      rejectSave(Object.assign(new Error('Not found'), {
        data: { message: 'Not found', why: 'feature_unavailable' },
      }))
      await flushPromises()

      const toggle = wrapper.get(selector).element as HTMLInputElement

      expect(toggle.checked).toBe(false)
      expect(wrapper.get(selector).attributes('aria-busy')).toBe('false')
      expect(mocks.error).toHaveBeenCalledWith('Not found', expect.anything())
      expect(mocks.refreshFeatures).not.toHaveBeenCalled()
    })

  it('links a readiness hint to the keys page when a key kind is missing',
    async () => {
      mocks.keyStatus.mockReturnValue('missing')

      const wrapper = await mountPage()
      const hint = wrapper.get(
        '[data-testid="labs-readiness-artifacts.llm-bridge-provider"]',
      )

      expect(hint.attributes('href') ?? hint.attributes('to')).toBe('/profile/keys')
      expect(hint.text()).toContain('Needs an API key')
    })

  it('hides readiness hints while the key summary is unknown', async () => {
    mocks.keyStatus.mockReturnValue('unknown')

    const wrapper = await mountPage()

    expect(wrapper.find('[data-testid^="labs-readiness-"]').exists())
      .toBe(false)
  })

  it('shows the empty state and still the experiments switch', async () => {
    const wrapper = await mountPage({ features: [] })

    expect(wrapper.get('[data-testid="labs-empty"]').text())
      .toContain('No experimental features are available')
    expect(wrapper.find('[data-testid="labs-experiments-toggle"]').exists())
      .toBe(true)
  })

  it('shows the error state with a retry button', async () => {
    const wrapper = await mountPage({
      data: null,
      error: new Error('failed'),
      status: 'error',
    })

    expect(wrapper.find('[data-testid="labs-error"]').exists()).toBe(true)

    await wrapper.get('[data-testid="labs-retry"]').trigger('click')

    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('shows skeletons while loading', async () => {
    const wrapper = await mountPage({ data: null, status: 'pending' })

    expect(wrapper.findAll('[data-testid="labs-skeleton"]').length)
      .toBeGreaterThan(0)
  })

  it('has the experiments switch on by default with the objection notice',
    async () => {
      const wrapper = await mountPage()
      const toggle = wrapper.get('[data-testid="labs-experiments-toggle"]')

      expect((toggle.element as HTMLInputElement).checked).toBe(true)
      expect(wrapper.get('[data-testid="labs-experiments-notice"]').text())
        .toContain('You can object to this at any time by turning it off')
    })

  it('records an objection when the experiments switch is turned off',
    async () => {
      const wrapper = await mountPage()

      await wrapper.get('[data-testid="labs-experiments-toggle"]')
        .setValue(false)
      await flushPromises()

      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/profiles/features/experiments',
        { method: 'POST', body: { objected: true } },
      )
      expect(mocks.refreshFeatures).toHaveBeenCalled()
    })

  it('shows the switch off for a user who objected', async () => {
    const wrapper = await mountPage({ objectedToExperiments: true })
    const toggle = wrapper.get('[data-testid="labs-experiments-toggle"]')

    expect((toggle.element as HTMLInputElement).checked).toBe(false)
  })

  it('never uses paid-tier wording', async () => {
    const wrapper = await mountPage()
    const text = wrapper.text().toLowerCase()

    for (const word of ['premium', 'exclusive', 'members', 'early access']) {
      expect(text).not.toContain(word)
    }

    expect(text).toContain('may change or be removed')
  })

  it('is the sixth tab of the profile layout', async () => {
    const layout = await mountSuspended(ProfileLayout, {
      global: { stubs: { NuxtPage: true, SidebarThemeSwitcher: true } },
    })
    const tabs = layout.findAll('nav[aria-label="Account sections"] a')

    expect(tabs).toHaveLength(6)
    expect(tabs.at(-1)?.text()).toBe('Labs')
  })
})
