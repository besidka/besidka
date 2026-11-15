import { shallowRef } from 'vue'
import { mockComponent, mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SkillsCard from '../../../../app/components/Projects/SkillsCard.vue'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  refresh: vi.fn(),
  errorMessage: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useErrorMessage', () => mocks.errorMessage)

const view = shallowRef<Record<string, unknown> | null>(null)

mockNuxtImport('useLazyFetch', () => {
  return vi.fn(() => ({
    data: view,
    status: shallowRef('success'),
    refresh: mocks.refresh,
  }))
})

mockNuxtImport('useComposerSkills', () => {
  return vi.fn(() => ({
    items: shallowRef([
      {
        id: 'skl-pinned',
        name: 'pinned-skill',
        description: 'Pinned',
        version: 1,
        mode: 'ask',
        command: null,
      },
      {
        id: 'skl-free',
        name: 'free-skill',
        description: 'Free',
        version: 1,
        mode: 'auto',
        command: null,
      },
    ]),
    isVisible: shallowRef(true),
    refresh: vi.fn(),
  }))
})

enableAutoUnmount(afterEach)

mockComponent('ChatInputSkillPicker', () => {
  return {
    props: ['open', 'items', 'selectedId', 'subtitle'],
    emits: ['update:open', 'pick'],
    template: `
      <ul data-testid="picker">
        <li
          v-for="item in items"
          :key="item.id"
          :data-testid="'pick-' + item.name"
          @click="$emit('pick', item)"
        >
          {{ item.name }}
        </li>
      </ul>
    `,
  }
})

function pinsView(pins: Array<Record<string, unknown>>) {
  return {
    pins,
    limits: { always: 3, total: 20, alwaysTokens: 12000 },
    alwaysTokens: pins.reduce((total, pin) => {
      return total + (typeof pin.tokens === 'number' ? pin.tokens : 0)
    }, 0),
  }
}

function pin(overrides: Record<string, unknown> = {}) {
  return {
    skillId: 'skl-pinned',
    name: 'pinned-skill',
    description: 'Pinned',
    level: 'always',
    position: 0,
    state: 'active',
    tokens: 1234,
    ...overrides,
  }
}

async function mountCard() {
  return await mountSuspended(SkillsCard, {
    props: { projectId: 'project-1' },
    global: {
      stubs: {
        UiBubble: { template: '<div><slot /></div>' },
      },
    },
  })
}

describe('Projects/SkillsCard', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.refresh.mockReset()
    mocks.errorMessage.mockReset()
    view.value = pinsView([])
  })

  it('shows the empty state', async () => {
    const wrapper = await mountCard()

    expect(wrapper.get('[data-testid="project-skills-empty"]').exists())
      .toBe(true)
    expect(wrapper.find('[data-testid="project-skills-tokens"]').exists())
      .toBe(false)
  })

  it('shows the level, the token estimate and the total', async () => {
    view.value = pinsView([pin()])

    const wrapper = await mountCard()

    expect(wrapper.text()).toContain('pinned-skill')
    expect(wrapper.get('[data-testid="project-skill-note-pinned-skill"]').text())
      .toContain('≈ 1,234 tokens in every message')
    expect(wrapper.get('[data-testid="project-skills-tokens"]').text())
      .toContain('≈ 1,234 tokens in every message')
    expect(
      (wrapper.get('[data-testid="project-skill-level-pinned-skill"]')
        .element as HTMLSelectElement).value,
    ).toBe('always')
  })

  it('shows an Off skill as Off with the reason it does not load', async () => {
    view.value = pinsView([pin({ state: 'off', tokens: null })])

    const wrapper = await mountCard()

    expect(wrapper.get('[data-testid="project-skill-state-pinned-skill"]')
      .text()).toBe('Off')
    expect(wrapper.get('[data-testid="project-skill-note-pinned-skill"]')
      .text()).toContain('Turn the skill on')
    expect(wrapper.find('[data-testid="project-skills-tokens"]').exists())
      .toBe(false)
  })

  it('offers only skills that are not pinned yet and adds one as Always load', async () => {
    view.value = pinsView([pin()])
    mocks.fetch.mockResolvedValue(pinsView([pin()]))

    const wrapper = await mountCard()

    await wrapper.get('[data-testid="project-skills-add"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="pick-pinned-skill"]').exists())
      .toBe(false)

    await wrapper.get('[data-testid="pick-free-skill"]').trigger('click')
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/skills',
      {
        method: 'PUT',
        body: {
          skills: [
            { skillId: 'skl-pinned', level: 'always' },
            { skillId: 'skl-free', level: 'always' },
          ],
        },
      },
    )
  })

  it('adds as Prefer when three skills already load in every message', async () => {
    view.value = pinsView([
      pin({ skillId: 'a', name: 'a-skill', position: 0 }),
      pin({ skillId: 'b', name: 'b-skill', position: 1 }),
      pin({ skillId: 'c', name: 'c-skill', position: 2 }),
    ])
    mocks.fetch.mockResolvedValue(view.value)

    const wrapper = await mountCard()

    await wrapper.get('[data-testid="project-skills-add"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="pick-free-skill"]').trigger('click')
    await flushPromises()

    expect(mocks.fetch.mock.calls[0]![1].body.skills.at(-1))
      .toEqual({ skillId: 'skl-free', level: 'prefer' })
  })

  it('changes a level and removes a skill with the whole list', async () => {
    view.value = pinsView([pin()])
    mocks.fetch.mockResolvedValue(pinsView([pin({ level: 'prefer' })]))

    const wrapper = await mountCard()
    const select = wrapper.get('[data-testid="project-skill-level-pinned-skill"]')

    await select.setValue('prefer')
    await flushPromises()

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/projects/project-1/skills',
      {
        method: 'PUT',
        body: { skills: [{ skillId: 'skl-pinned', level: 'prefer' }] },
      },
    )

    await wrapper.get('[data-testid="project-skill-remove-pinned-skill"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/projects/project-1/skills',
      { method: 'PUT', body: { skills: [] } },
    )
  })

  it('shows the server reason and restores the level when a save fails', async () => {
    view.value = pinsView([pin()])
    mocks.fetch.mockRejectedValue({
      data: {
        message: 'Project skills were not saved',
        why: 'A project can load 3 skills in every message.',
      },
    })

    const wrapper = await mountCard()
    const select = wrapper.get('[data-testid="project-skill-level-pinned-skill"]')

    await select.setValue('prefer')
    await flushPromises()

    expect(mocks.errorMessage).toHaveBeenCalledWith(
      'Project skills were not saved',
      'A project can load 3 skills in every message.',
    )
    expect(mocks.refresh).toHaveBeenCalled()
    expect((select.element as HTMLSelectElement).value).toBe('always')
  })
})
