import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { shallowRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScopeSwitch from '../../../../../../app/components/Profile/Memory/Entries/ScopeSwitch.vue'

const mocks = vi.hoisted(() => ({
  useLazyFetch: vi.fn(),
}))

mockNuxtImport('useLazyFetch', () => mocks.useLazyFetch)

enableAutoUnmount(afterEach)

async function mountSwitch(projectId: string | null = null) {
  return await mountSuspended(ScopeSwitch, { props: { projectId } })
}

function optionLabels(wrapper: Awaited<ReturnType<typeof mountSwitch>>) {
  return wrapper.findAll('option').map(option => option.text())
}

describe('Profile/Memory/Entries/ScopeSwitch', () => {
  beforeEach(() => {
    mocks.useLazyFetch.mockReset()
    mocks.useLazyFetch.mockReturnValue({
      data: shallowRef({
        pinned: [{ id: 'project-pinned', name: 'Pinned project' }],
        projects: [{ id: 'project-1', name: 'Home lab' }],
        nextCursor: null,
      }),
    })
  })

  it('fetches up to 100 projects', async () => {
    await mountSwitch()

    expect(mocks.useLazyFetch).toHaveBeenCalledWith(
      '/api/v1/projects',
      expect.objectContaining({ query: { limit: 100 } }),
      expect.any(String),
    )
  })

  it('has an accessible label', async () => {
    const wrapper = await mountSwitch()

    expect(wrapper.get('select').attributes('aria-label'))
      .toBe('Memory scope')
  })

  it('lists the account and every project', async () => {
    const wrapper = await mountSwitch()

    expect(optionLabels(wrapper))
      .toEqual(['Account', 'Pinned project', 'Home lab'])
  })

  it('selects the account when no project is set', async () => {
    const wrapper = await mountSwitch()

    expect(wrapper.get<HTMLSelectElement>('select').element.value)
      .toBe('account')
  })

  it('selects the project from the url', async () => {
    const wrapper = await mountSwitch('project-1')

    expect(wrapper.get<HTMLSelectElement>('select').element.value)
      .toBe('project-1')
  })

  it('shows an unlisted project as a generic project', async () => {
    const wrapper = await mountSwitch('archived-project')

    expect(optionLabels(wrapper)).toContain('Project')
    expect(wrapper.get<HTMLSelectElement>('select').element.value)
      .toBe('archived-project')
  })

  it('emits the project id when a project is chosen', async () => {
    const wrapper = await mountSwitch()

    await wrapper.get('select').setValue('project-1')

    expect(wrapper.emitted('change')).toEqual([['project-1']])
  })

  it('emits null when the account is chosen', async () => {
    const wrapper = await mountSwitch('project-1')

    await wrapper.get('select').setValue('account')

    expect(wrapper.emitted('change')).toEqual([[null]])
  })

  it('still offers the account while projects are loading', async () => {
    mocks.useLazyFetch.mockReturnValue({ data: shallowRef(null) })

    const wrapper = await mountSwitch()

    expect(optionLabels(wrapper)).toEqual(['Account'])
  })
})
