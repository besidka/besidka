import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SidebarDevelopment from '../../../../app/components/Sidebar/Development.vue'

const mocks = vi.hoisted(() => ({
  route: { path: '', params: {}, meta: {} } as {
    path: string
    params: Record<string, string>
    meta: Record<string, unknown>
  },
  excludedSlugs: new Set<string>(),
  setChatMemoryExcluded: vi.fn(),
}))

mockNuxtImport('useRoute', () => () => mocks.route)

mockNuxtImport('useChatMemoryExclusion', () => {
  return () => ({
    savingSlug: { value: null },
    isChatMemoryExcluded: (slug: string) => mocks.excludedSlugs.has(slug),
    rememberChatMemoryExcluded: vi.fn(),
    setChatMemoryExcluded: mocks.setChatMemoryExcluded,
  })
})

const uiButtonStub = {
  props: ['title', 'iconName', 'disabled'],
  emits: ['click'],
  template: `
    <button
      type="button"
      :title="title"
      :data-icon="iconName"
      :disabled="disabled"
      @click="$emit('click', $event)"
    />
  `,
}

const submenuStub = {
  template: '<div><slot name="trigger" /><slot /></div>',
}

const CHAT_SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

function mountDevelopment(path = `/chats/${CHAT_SLUG}`) {
  mocks.route = {
    path,
    params: path === '/chats/new' ? {} : { slug: CHAT_SLUG },
    meta: { layout: 'chat' },
  }

  return mountSuspended(SidebarDevelopment, {
    global: {
      stubs: {
        LazySidebarSubmenu: submenuStub,
        SidebarSubmenu: submenuStub,
        UiButton: uiButtonStub,
      },
    },
  })
}

describe('Sidebar/Development memory exclusion', () => {
  beforeEach(() => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
      return {
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as MediaQueryList
    })
    mocks.excludedSlugs.clear()
    mocks.setChatMemoryExcluded.mockReset()
    mocks.setChatMemoryExcluded.mockResolvedValue(true)
  })

  it('offers to exclude an included chat', async () => {
    const wrapper = await mountDevelopment()
    const button = wrapper.get('[data-testid="sidebar-memory-exclusion"]')

    expect(button.attributes('title')).toBe('Don\'t use this chat for memory')

    await button.trigger('click')

    expect(mocks.setChatMemoryExcluded).toHaveBeenCalledWith(CHAT_SLUG, true)
  })

  it('offers to include an excluded chat again', async () => {
    mocks.excludedSlugs.add(CHAT_SLUG)

    const wrapper = await mountDevelopment()
    const button = wrapper.get('[data-testid="sidebar-memory-exclusion"]')

    expect(button.attributes('title')).toBe('Use this chat for memory')

    await button.trigger('click')

    expect(mocks.setChatMemoryExcluded).toHaveBeenCalledWith(CHAT_SLUG, false)
  })

  it('is not offered on the new chat page', async () => {
    const wrapper = await mountDevelopment('/chats/new')

    expect(wrapper.find('[data-testid="sidebar-memory-exclusion"]').exists())
      .toBe(false)
  })
})
