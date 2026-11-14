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

  it('shows the state of the skill in the enable toggle', async () => {
    const wrapper = await mountSuspended(DetailHeader, {
      props: { skillId: 'S1' },
    })

    expect(wrapper.get(testId('skill-detail-enable')).text()).toBe('Off')
    expect((wrapper.get(testId('skill-detail-toggle')).element as HTMLInputElement)
      .checked).toBe(false)
  })

  it('turns a skill the user wrote on without a confirmation', async () => {
    const wrapper = await mountSuspended(DetailHeader, {
      props: { skillId: 'S1' },
    })

    await wrapper.get(testId('skill-detail-toggle')).trigger('click')
    await flushPromises()

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/skills/S1', {
      method: 'PATCH',
      body: { enabled: true },
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

    await wrapper.get(testId('skill-detail-toggle')).trigger('click')
    await flushPromises()

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('disables the toggle for a broken skill', async () => {
    detail.value = createSkillDetail({ id: 'S1', status: 'broken' })

    const wrapper = await mountSuspended(DetailHeader, {
      props: { skillId: 'S1' },
    })

    expect(wrapper.get(testId('skill-detail-toggle')).attributes('disabled'))
      .toBeDefined()
  })
})
