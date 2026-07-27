import type { RouterConfig } from '@nuxt/schema'
import type { RouteLocationNormalized } from 'vue-router'
import { createMemoryHistory, START_LOCATION } from 'vue-router'

// Chat routes manage their own scroll container and math in extreme detail
// (see app/composables/chat-scroll-spacer.ts + app/pages/chats/[slug].vue)
// -- pinning user messages to the top, reserving space for pending
// research/images, reacting to chat-input:height. app.vue only renders the
// generic `.overflow-y-auto` wrapper (the container this file otherwise
// manages) for every OTHER route, so this is the single condition to mirror
// to stay out of the chat page's way.
const CHAT_OWNED_ROUTE_NAME: string = 'chats-slug'

// Known gap: the browser can defer "scroll the newly-focused element (the
// just-clicked link) into view" by roughly a frame after a click, and this
// isn't specific to hash links -- a footer link sitting at the bottom of
// the document can drag the LEAVING page's container all the way down
// before the route change is even recorded. The async branch below
// re-applies the scroll decision a frame later to reclaim a loss on the
// ARRIVING page; there is no equivalent second pass for the synchronous
// same-path branch (a hash click's Back/Forward), so that path's
// containerScrollPositions entry can still end up holding the transient
// jump instead of the true pre-click position. Tried and reverted:
// pausing containerScrollPositions writes from router.beforeEach() (fires
// too late -- the jump already lands before it), and re-asserting the
// leaving entry's value here in scrollBehavior (unreliable --
// history.state.scrollKey had sometimes already advanced to the new entry
// by the time this ran, which would corrupt the destination's own key on
// an ordinary cross-page push instead of protecting the one being left).

function applyContainerScroll(
  to: RouteLocationNormalized,
  savedPosition: unknown,
): void {
  if (savedPosition) {
    if (restoreContainerScrollPosition()) {
      return
    }

    scrollContainerToTop()

    return
  }

  if (to.hash) {
    scrollToHash(to.hash, { instant: true })

    return
  }

  scrollContainerToTop()
}

export default {
  history: (base) => {
    if (import.meta.test) {
      return createMemoryHistory(base)
    }

    return null
  },
  scrollBehavior(to, from, savedPosition) {
    if (import.meta.server) {
      return false
    }

    if (to.name === CHAT_OWNED_ROUTE_NAME) {
      return false
    }

    trackContainerScrollPosition()

    const isSamePath = from !== START_LOCATION
      && to.path.replace(/\/$/, '') === from.path.replace(/\/$/, '')

    // Same-path hash pushes (clicking a body anchor while already on the
    // page) are already owned by useHashAnchorScroll()'s watch(route.hash)
    // (smooth scroll) -- only step in here for the case it can't handle:
    // restoring a saved position on back/forward. Anything else on the
    // same path (a plain query change, e.g. chats/new's project picker)
    // is left alone.
    if (isSamePath) {
      if (!savedPosition) {
        return false
      }

      applyContainerScroll(to, savedPosition)

      return false
    }

    // Nuxt's router plugin fakes `from` as START_LOCATION for the very
    // first call this function ever receives (whatever the user's first
    // real navigation turns out to be), and never waits for a page-load
    // hook in that case -- mirrored here rather than waiting on a
    // `page:loading:end` that may already have fired during hydration.
    if (from === START_LOCATION) {
      applyContainerScroll(to, savedPosition)

      return false
    }

    const nuxtApp = useNuxtApp()

    return new Promise((resolve) => {
      nuxtApp.hooks.hookOnce('page:loading:end', () => {
        requestAnimationFrame(() => {
          applyContainerScroll(to, savedPosition)

          // The browser can defer its own "scroll the newly-focused
          // element (the just-clicked link) into view" past this point --
          // e.g. a footer link sitting at the bottom of the page it
          // navigated away from can drag this container down after we've
          // already applied the correct position. Re-applying is
          // idempotent for all three cases applyContainerScroll handles
          // (top-reset, hash-scroll, restore), so reasserting it one more
          // frame later reclaims the loss without risking a new one.
          requestAnimationFrame(() => {
            applyContainerScroll(to, savedPosition)
            resolve(false)
          })
        })
      })
    })
  },
} satisfies RouterConfig
