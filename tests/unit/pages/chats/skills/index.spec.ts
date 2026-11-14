import {
  mockComponent,
  mockNuxtImport,
  mountSuspended,
} from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import SkillsPage from '../../../../../app/pages/chats/skills/index.vue'
import { createSkillSummary } from '../../../../setup/helpers/skills-ui'

const mocks = vi.hoisted(() => ({
  navigateTo: vi.fn(),
  fetch: vi.fn(),
  confirm: vi.fn(),
  refresh: vi.fn(),
  refreshNuxtData: vi.fn(),
  warning: vi.fn(),
}))

const skillsActive = ref<boolean>(true)
const importActive = ref<boolean>(true)
const list = ref<unknown>(null)
const listStatus = ref<string>('success')
const listError = ref<unknown>(null)

mockNuxtImport('navigateTo', () => mocks.navigateTo)
mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('refreshNuxtData', () => mocks.refreshNuxtData)
mockNuxtImport('useWarningMessage', () => mocks.warning)
mockNuxtImport('useFeature', () => {
  return (key: string) => computed(() => {
    const active = key === 'skills'
      ? skillsActive.value
      : key === 'skills.import-url' && importActive.value

    return { enabled: active, active, variant: null }
  })
})
mockNuxtImport('useLazyFetch', () => {
  return () => ({
    data: list,
    status: listStatus,
    error: listError,
    refresh: mocks.refresh,
  })
})

enableAutoUnmount(afterEach)

mockComponent('ProfileSkillsEditDialog', async () => {
  const { defineComponent, h } = await import('vue')

  return defineComponent({
    props: { skillId: { type: String, required: true } },
    emits: ['saved', 'close'],
    setup(props, { emit }) {
      return () => h('button', {
        'data-testid': 'edit-dialog-stub',
        'data-skill-id': props.skillId,
        'onClick': () => emit('saved', {
          id: props.skillId,
          version: 4,
          isRenamed: true,
        }),
      })
    },
  })
})

const skills = [
  createSkillSummary({ id: 'a', name: 'alpha' }),
  createSkillSummary({
    id: 'b',
    name: 'beta',
    sourceKind: 'github',
    pendingVersion: 3,
    status: 'needs-review',
  }),
]

function setList(items = skills) {
  list.value = {
    skills: items,
    counts: {
      sources: { all: items.length, created: 1, imported: 1, apps: 0 },
    },
  }
}

function findInBody(id: string): HTMLElement | null {
  return document.body.querySelector(`[data-testid="${id}"]`)
}

function testId(id: string) {
  return `[data-testid="${id}"]`
}

function mountPage(route?: string) {
  return mountSuspended(SkillsPage, {
    ...(route ? { route } : {}),
    global: {
      stubs: {
        teleport: false,
        LazyProfileSkillsUpdateReview: true,
      },
    },
  })
}

describe('chats skills page', () => {
  beforeEach(() => {
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.removeAttribute('open')
        this.dispatchEvent(new Event('close'))
      })
    document.body.innerHTML = ''
    skillsActive.value = true
    importActive.value = true
    listStatus.value = 'success'
    listError.value = null
    list.value = null
    mocks.navigateTo.mockReset()
    mocks.fetch.mockReset()
    mocks.confirm.mockReset()
    mocks.refresh.mockReset()
    mocks.refreshNuxtData.mockReset()
    mocks.warning.mockReset()
    setList()
    useSidePanel().close()
    useSkillUpdateReview().close()
    useSkillEditSession().close()
  })

  it('renders the heading, the rows and the New menu with the skills flag on', async () => {
    const wrapper = await mountPage()

    expect(wrapper.get('h1').text()).toBe('Skills')
    expect(wrapper.find(testId('tab-skills')).attributes('aria-current'))
      .toBe('page')
    expect(wrapper.text()).toContain(
      'Skills teach the model how to do a task your way. Give a skill a command to run it with /command.',
    )
    expect(wrapper.findAll(testId('skill-row'))).toHaveLength(2)
    expect(wrapper.find(testId('skills-new-trigger')).exists()).toBe(true)
    expect(wrapper.find(testId('skills-new-github')).exists()).toBe(true)
  })

  it('has no kind filter and no blank skill or command entries', async () => {
    const wrapper = await mountPage()

    expect(wrapper.find(testId('skills-kind-filter')).exists()).toBe(false)
    expect(wrapper.find(testId('skills-new-blank')).exists()).toBe(false)
    expect(wrapper.find(testId('skills-new-command')).exists()).toBe(false)
  })

  it('renders no content and leaves the page when the skills flag is off', async () => {
    skillsActive.value = false

    const wrapper = await mountPage()

    expect(wrapper.find(testId('tab-skills')).exists()).toBe(false)
    expect(wrapper.find(testId('skill-row')).exists()).toBe(false)
    expect(wrapper.find(testId('skills-new-trigger')).exists()).toBe(false)
    expect(mocks.navigateTo).toHaveBeenCalledWith(
      '/chats/history',
      { replace: true },
    )
  })

  it('hides the GitHub item without the import flag', async () => {
    importActive.value = false

    const wrapper = await mountPage()

    expect(wrapper.find(testId('skills-new-github')).exists()).toBe(false)
  })

  it('shows the review banner with the number of skills to review', async () => {
    const wrapper = await mountPage()

    expect(wrapper.get(testId('skills-review-banner')).text())
      .toContain('1 skill needs review')
    expect(wrapper.get(testId('skills-review-banner')).classes())
      .toContain('alert-warning')
    expect(wrapper.get(testId('skills-review-banner')).classes())
      .toContain('alert-soft')
  })

  it('has no banner when nothing needs review', async () => {
    setList([createSkillSummary()])

    const wrapper = await mountPage()

    expect(wrapper.find(testId('skills-review-banner')).exists()).toBe(false)
  })

  it('opens a pending update review from the banner', async () => {
    const wrapper = await mountPage()

    await wrapper.get(testId('skills-review-banner-action')).trigger('click')

    expect(useSkillUpdateReview().skillId.value).toBe('b')
  })

  it('opens the detail in the side panel with a skill view key', async () => {
    const wrapper = await mountPage()

    await wrapper.findAll(testId('skill-row-open'))[0]!.trigger('click')

    const sidePanel = useSidePanel()

    expect(sidePanel.viewKey.value).toBe('skill:a')
    expect(sidePanel.currentView.value?.title).toBe('alpha')
  })

  it('creates a skill from the New menu and opens it in the editor', async () => {
    mocks.fetch.mockResolvedValue({ id: 'n1', name: 'summarise' })

    const wrapper = await mountPage()

    await wrapper.get(testId('skills-new-skill')).trigger('click')
    await vi.waitFor(() => {
      expect(findInBody('skill-create-form')).not.toBeNull()
    })

    const input = findInBody('skill-create-name') as HTMLInputElement

    input.value = 'summarise'
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    findInBody('skill-create-submit')!.click()
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/skills', {
      method: 'POST',
      body: { kind: 'blank', name: 'summarise', mode: 'auto' },
    })
    expect(mocks.refreshNuxtData).toHaveBeenCalled()
    expect(useSkillEditSession().skillId.value).toBe('n1')
    expect(useSidePanel().viewKey.value).toBeNull()
  })

  it('opens the editor from the Edit action of a row', async () => {
    const wrapper = await mountPage()

    await wrapper.findAll(testId('skill-action-edit'))[0]!.trigger('click')

    expect(useSkillEditSession().skillId.value).toBe('a')
  })

  it('mounts the editor for the skill that is being edited', async () => {
    const wrapper = await mountPage()

    await wrapper.findAll(testId('skill-action-edit'))[0]!.trigger('click')
    await vi.waitFor(() => {
      expect(wrapper.find(testId('edit-dialog-stub')).exists()).toBe(true)
    })

    expect(wrapper.get(testId('edit-dialog-stub')).attributes('data-skill-id'))
      .toBe('a')
  })

  it('refreshes the open detail panel with the new name after a rename', async () => {
    const wrapper = await mountPage()

    await wrapper.findAll(testId('skill-row-open'))[0]!.trigger('click')
    expect(useSidePanel().currentView.value?.title).toBe('alpha')

    list.value = {
      ...(list.value as object),
      skills: [
        createSkillSummary({ id: 'a', name: 'alpha-renamed' }),
        skills[1],
      ],
    }
    await wrapper.findAll(testId('skill-action-edit'))[0]!.trigger('click')
    await vi.waitFor(() => {
      expect(wrapper.find(testId('edit-dialog-stub')).exists()).toBe(true)
    })
    await wrapper.get(testId('edit-dialog-stub')).trigger('click')

    expect(useSidePanel().currentView.value?.title).toBe('alpha-renamed')
    expect(useSidePanel().viewKey.value).toBe('skill:a')
  })

  it('leaves the detail panel alone when another skill is renamed', async () => {
    const wrapper = await mountPage()

    await wrapper.findAll(testId('skill-row-open'))[1]!.trigger('click')
    await wrapper.findAll(testId('skill-action-edit'))[0]!.trigger('click')
    await vi.waitFor(() => {
      expect(wrapper.find(testId('edit-dialog-stub')).exists()).toBe(true)
    })
    await wrapper.get(testId('edit-dialog-stub')).trigger('click')

    expect(useSidePanel().currentView.value?.title).toBe('beta')
  })

  it('opens the import dialog on the tab that was chosen', async () => {
    const wrapper = await mountPage()

    await wrapper.get(testId('skills-new-paste')).trigger('click')
    await vi.waitFor(() => {
      expect(findInBody('skill-import-text')).not.toBeNull()
    })

    expect(findInBody('skill-import-tab-paste')!.getAttribute('aria-selected'))
      .toBe('true')
  })

  it('shows the error state with Retry', async () => {
    list.value = null
    listError.value = { data: { message: 'Network down' } }

    const wrapper = await mountPage()

    expect(wrapper.get(testId('skills-error')).text()).toContain('Network down')

    await wrapper.get(testId('skills-retry')).trigger('click')

    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('shows the empty state when there are no skills', async () => {
    setList([])

    const wrapper = await mountPage()

    expect(wrapper.find(testId('skills-empty')).exists()).toBe(true)
  })

  async function pickRowMode(
    wrapper: Awaited<ReturnType<typeof mountPage>>,
    mode: string,
  ) {
    const select = wrapper.get(testId('skill-row-mode-select'))
      .element as HTMLSelectElement

    select.value = mode
    select.dispatchEvent(new Event('change'))
    await flushPromises()
  }

  it('asks before turning on a skill the user did not write', async () => {
    mocks.confirm.mockResolvedValue(null)
    setList([createSkillSummary({
      id: 'z',
      name: 'zip-skill',
      sourceKind: 'zip',
      enabled: false,
    })])

    const wrapper = await mountPage()

    await pickRowMode(wrapper, 'ask')

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('turns on a skill the user wrote without asking', async () => {
    mocks.fetch.mockResolvedValue({})
    setList([createSkillSummary({ id: 'a', enabled: false })])

    const wrapper = await mountPage()

    await pickRowMode(wrapper, 'auto')

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/skills/a', {
      method: 'PATCH',
      body: { mode: 'auto' },
    })
  })

  describe('opening a skill from a link', () => {
    it('opens the details and the editor for ?skill=<id>&edit=1, then clears the query', async () => {
      await mountPage('/chats/skills?skill=a&edit=1')

      await vi.waitFor(() => {
        expect(useRoute().query.skill).toBeUndefined()
      })

      expect(useSidePanel().viewKey.value).toBe('skill:a')
      expect(useSkillEditSession().skillId.value).toBe('a')
      expect(useRoute().query.edit).toBeUndefined()
    })

    it('opens only the details without edit=1', async () => {
      await mountPage('/chats/skills?skill=b')

      await vi.waitFor(() => {
        expect(useRoute().query.skill).toBeUndefined()
      })

      expect(useSidePanel().viewKey.value).toBe('skill:b')
      expect(useSkillEditSession().skillId.value).toBeNull()
    })

    it('keeps the other query parameters it did not use', async () => {
      await mountPage('/chats/skills?skill=a&source=created')

      await vi.waitFor(() => {
        expect(useRoute().query.skill).toBeUndefined()
      })

      expect(useRoute().query).toEqual({ source: 'created' })
    })

    it('warns about a skill that is gone and opens nothing', async () => {
      await mountPage('/chats/skills?skill=gone&edit=1')

      await vi.waitFor(() => {
        expect(useRoute().query.skill).toBeUndefined()
      })

      expect(mocks.warning).toHaveBeenCalledWith(
        'That skill is not available',
        expect.any(String),
      )
      expect(useSidePanel().viewKey.value).toBeNull()
      expect(useSkillEditSession().skillId.value).toBeNull()
      expect(useRoute().query.skill).toBeUndefined()
    })
  })
})
