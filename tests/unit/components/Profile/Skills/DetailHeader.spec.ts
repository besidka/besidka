import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import DetailHeader from '../../../../../app/components/Profile/Skills/DetailHeader.vue'
import { createSkillDetail } from '../../../../setup/helpers/skills-ui'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  confirm: vi.fn(),
  refreshNuxtData: vi.fn(),
}))

const detail = ref<unknown>(null)

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('refreshNuxtData', () => mocks.refreshNuxtData)
mockNuxtImport('useLazyFetch', () => {
  return () => ({
    data: detail,
    status: ref('success'),
    error: ref(null),
    refresh: vi.fn(),
  })
})

enableAutoUnmount(afterEach)

function testId(id: string) {
  return `[data-testid="${id}"]`
}

describe('Profile/Skills/DetailHeader', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.fetch.mockResolvedValue({})
    mocks.confirm.mockReset()
    mocks.refreshNuxtData.mockReset()
    detail.value = createSkillDetail({ id: 'S1', enabled: false })
  })

  it('opens the editor from the Edit button', async () => {
    useSkillEditSession().close()
    detail.value = createSkillDetail({ id: 'S1', name: 'review-pr' })

    const wrapper = await mountSuspended(DetailHeader, {
      props: { skillId: 'S1' },
    })
    const edit = wrapper.get(testId('skill-detail-edit'))

    expect(edit.text()).toBe('Edit')
    expect(edit.attributes('aria-label')).toBe('Edit review-pr')

    await edit.trigger('click')

    expect(useSkillEditSession().skillId.value).toBe('S1')
    useSkillEditSession().close()
  })

  it('shows the mode of the skill in the mode control', async () => {
    const wrapper = await mountSuspended(DetailHeader, {
      props: { skillId: 'S1' },
    })

    expect((wrapper.get(testId('skill-detail-mode-select')).element as HTMLSelectElement)
      .value).toBe('off')
  })

  async function pickMode(
    wrapper: Awaited<ReturnType<typeof mountSuspended>>,
    mode: string,
  ) {
    const select = wrapper.get(testId('skill-detail-mode-select'))
      .element as HTMLSelectElement

    select.value = mode
    select.dispatchEvent(new Event('change'))
    await flushPromises()
  }

  it('turns a skill the user wrote on without a confirmation', async () => {
    const wrapper = await mountSuspended(DetailHeader, {
      props: { skillId: 'S1' },
    })

    await pickMode(wrapper, 'auto')

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/skills/S1', {
      method: 'PATCH',
      body: { mode: 'auto' },
    })
  })

  it('asks before turning on an imported skill', async () => {
    mocks.confirm.mockResolvedValue(null)
    detail.value = createSkillDetail({
      id: 'S1',
      enabled: false,
      sourceKind: 'github',
    })

    const wrapper = await mountSuspended(DetailHeader, {
      props: { skillId: 'S1' },
    })

    await pickMode(wrapper, 'ask')

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('disables the mode control for a broken skill', async () => {
    detail.value = createSkillDetail({ id: 'S1', status: 'broken' })

    const wrapper = await mountSuspended(DetailHeader, {
      props: { skillId: 'S1' },
    })

    expect(wrapper.get(testId('skill-detail-mode-select')).attributes('disabled'))
      .toBeDefined()
  })
})
