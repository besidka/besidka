const TEST_CHAT_SLUG = 'test'

/**
 * The chat the current route shows, shared by the nav pill, the ⋯ More menu,
 * the User menu and the chat context panel, so they agree on what a chat page
 * is. `/chats/new` is not an owned chat page (it has no chat yet), and
 * neither is the dev-only `/chats/test` fixture route.
 */
export function useChatRoute() {
  const route = useRoute()

  const routeSlug = computed<string>(() => {
    return 'slug' in route.params ? String(route.params.slug) : ''
  })

  const isOwnedChatPage = computed<boolean>(() => {
    return route.path.startsWith('/chats/')
      && !!routeSlug.value
      && route.path !== '/chats/new'
      && routeSlug.value !== TEST_CHAT_SLUG
  })

  const isSharedChatPage = computed<boolean>(() => {
    return route.path.startsWith('/shared/') && !!routeSlug.value
  })

  const isChatPage = computed<boolean>(() => {
    return isOwnedChatPage.value || isSharedChatPage.value
  })

  return {
    routeSlug,
    isOwnedChatPage,
    isSharedChatPage,
    isChatPage,
  }
}
