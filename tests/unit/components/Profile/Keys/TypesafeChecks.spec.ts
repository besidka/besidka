import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { computed, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JEV_ROLE_IDS } from '../../../../../shared/utils/jev-policy'
import TypesafeChecks
  from '../../../../../app/components/Profile/Keys/TypesafeChecks.vue'

const state = reactive<{
  isLoaded: boolean
  roles: Record<string, boolean>
}>({
  isLoaded: true,
  roles: {},
})

const mocks = vi.hoisted(() => ({
  setRole: vi.fn(),
}))

mockNuxtImport('useTypesafeRoles', () => {
  return () => ({
    isLoaded: computed(() => state.isLoaded),
    isRoleOn: (role: string) => state.roles[role] !== false,
    setRole: mocks.setRole,
  })
})

enableAutoUnmount(afterEach)

beforeEach(() => {
  state.isLoaded = true
  state.roles = {}
  mocks.setRole.mockReset().mockImplementation(async (
    role: string,
    isOn: boolean,
  ) => {
    state.roles = { ...state.roles, [role]: isOn }
  })
})

describe('Profile/Keys/TypesafeChecks', () => {
  it('opens with the data-handling alert and a Privacy Policy link',
    async () => {
      const wrapper = await mountSuspended(TypesafeChecks)
      const info = wrapper.get('[data-testid="typesafe-checks-info"]')
      const link = wrapper.get('[data-testid="typesafe-checks-privacy-link"]')

      expect(info.attributes('role')).toBe('alert')
      expect(info.text().replace(/\s+/g, ' ')).toContain('TypeSafe AI, Inc. '
        + '(US) receives only the text each enabled check needs. Data '
        + 'handling: SCCs, no training on API data.')
      expect(link.attributes('href') ?? link.attributes('to'))
        .toBe('/privacy-policy#typesafe-ai-checks')
    })

  it('renders one toggle per role, each with what is sent', async () => {
    const wrapper = await mountSuspended(TypesafeChecks)

    for (const role of JEV_ROLE_IDS) {
      const toggle = wrapper.get(`[data-testid="typesafe-role-toggle-${role}"]`)
      const description = wrapper.get(`#typesafe-role-${role}-description`)

      expect((toggle.element as HTMLInputElement).checked).toBe(true)
      expect(description.text()).toMatch(/sends /i)
    }
  })

  it('uses the agreed copy for the new roles', async () => {
    const wrapper = await mountSuspended(TypesafeChecks)
    const text = wrapper.text().replace(/\s+/g, ' ')

    expect(text).toContain('Decides per message whether a web search is '
      + 'needed. Sends your message and the last few turns. If TypeSafe AI '
      + 'doesn\'t answer, Besidka searches as usual.')
    expect(text).toContain('Sends the chat text being shared, with emails, '
      + 'phone numbers and card numbers removed. Never blocks sharing.')
    expect(text).toContain('results from your model\'s own web search can\'t '
      + 'be checked.')
  })

  it('shows a role switched off as unchecked and saves a flip', async () => {
    state.roles = { rerank: false }

    const wrapper = await mountSuspended(TypesafeChecks)
    const toggle = wrapper.get('[data-testid="typesafe-role-toggle-rerank"]')

    expect((toggle.element as HTMLInputElement).checked).toBe(false)

    await toggle.setValue(true)
    await flushPromises()

    expect(mocks.setRole).toHaveBeenCalledWith('rerank', true)
  })

  it('shows same-size skeletons instead of toggles while loading',
    async () => {
      state.isLoaded = false

      const wrapper = await mountSuspended(TypesafeChecks)

      for (const role of JEV_ROLE_IDS) {
        expect(wrapper.find(`[data-testid="typesafe-role-toggle-${role}"]`)
          .exists()).toBe(false)
        expect(wrapper.find(`[data-testid="typesafe-role-skeleton-${role}"]`)
          .exists()).toBe(true)
      }
    })
})
