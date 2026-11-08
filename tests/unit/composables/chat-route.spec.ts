import { reactive } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useChatRoute } from '../../../app/composables/chat-route'

const route = reactive<{ path: string, params: Record<string, string> }>({
  path: '',
  params: {},
})

mockNuxtImport('useRoute', () => () => route)

function setRoute(path: string, params: Record<string, string> = {}) {
  route.path = path
  route.params = params
}

describe('useChatRoute', () => {
  beforeEach(() => {
    setRoute('/', {})
  })

  it('recognizes an owned chat page and exposes its slug', () => {
    setRoute('/chats/01ARZ3NDEKTSV4RRFFQ69G5FAV', {
      slug: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    })

    const { routeSlug, isOwnedChatPage, isSharedChatPage, isChatPage }
      = useChatRoute()

    expect(routeSlug.value).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV')
    expect(isOwnedChatPage.value).toBe(true)
    expect(isSharedChatPage.value).toBe(false)
    expect(isChatPage.value).toBe(true)
  })

  it('recognizes a shared chat page', () => {
    setRoute('/shared/share-slug', { slug: 'share-slug' })

    const { routeSlug, isOwnedChatPage, isSharedChatPage, isChatPage }
      = useChatRoute()

    expect(routeSlug.value).toBe('share-slug')
    expect(isOwnedChatPage.value).toBe(false)
    expect(isSharedChatPage.value).toBe(true)
    expect(isChatPage.value).toBe(true)
  })

  it('does not treat the new chat page as an owned chat page', () => {
    setRoute('/chats/new', {})

    const { isOwnedChatPage, isChatPage } = useChatRoute()

    expect(isOwnedChatPage.value).toBe(false)
    expect(isChatPage.value).toBe(false)
  })

  it('does not treat the new chat page as owned even with a slug param',
    () => {
      setRoute('/chats/new', { slug: 'new' })

      expect(useChatRoute().isOwnedChatPage.value).toBe(false)
    })

  it('does not treat the dev-only test chat as an owned chat page', () => {
    setRoute('/chats/test', { slug: 'test' })

    const { isOwnedChatPage, isChatPage } = useChatRoute()

    expect(isOwnedChatPage.value).toBe(false)
    expect(isChatPage.value).toBe(false)
  })

  it('does not treat pages outside chats and shared as chat pages', () => {
    for (const path of ['/', '/profile/keys', '/chats/history', '/signin']) {
      setRoute(path, {})

      const { isOwnedChatPage, isSharedChatPage, isChatPage }
        = useChatRoute()

      expect(isOwnedChatPage.value).toBe(false)
      expect(isSharedChatPage.value).toBe(false)
      expect(isChatPage.value).toBe(false)
    }
  })

  it('needs a slug for a chat page', () => {
    setRoute('/chats/', {})

    expect(useChatRoute().isOwnedChatPage.value).toBe(false)

    setRoute('/shared/', {})

    expect(useChatRoute().isSharedChatPage.value).toBe(false)
  })

  it('has an empty slug on a page without a slug param', () => {
    setRoute('/profile/keys', {})

    expect(useChatRoute().routeSlug.value).toBe('')
  })

  it('follows route changes', () => {
    setRoute('/profile/keys', {})

    const { routeSlug, isOwnedChatPage, isChatPage } = useChatRoute()

    expect(isChatPage.value).toBe(false)

    setRoute('/chats/chat-1', { slug: 'chat-1' })

    expect(routeSlug.value).toBe('chat-1')
    expect(isOwnedChatPage.value).toBe(true)
    expect(isChatPage.value).toBe(true)
  })
})
