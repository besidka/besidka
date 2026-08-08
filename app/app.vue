<template>
  <ClientOnly>
    <LazyPwaRefresher v-if="$pwa?.needRefresh && !studioSession" />
  </ClientOnly>
  <NuxtPwaManifest />
  <NuxtRouteAnnouncer />
  <NuxtLoadingIndicator />
  <div class="flex flex-col h-svh overflow-hidden">
    <div
      :class="{
        'contents': $route.name === 'chats-slug',
        [`
          flex-1 overflow-y-auto overflow-x-hidden
          motion-safe:scroll-smooth
          pt-[var(--sat)]
          max-sm:pb-[calc(var(--spacing)_*_24_+_var(--sab))]
          [-webkit-overflow-scrolling:touch]
        `]: $route.name !== 'chats-slug',
      }"
      :tabindex="$route.name !== 'chats-slug' ? 0 : undefined"
      :role="$route.name !== 'chats-slug' ? 'region' : undefined"
      :aria-label="$route.name !== 'chats-slug' ? 'Page content' : undefined"
    >
      <NuxtErrorBoundary @error="onException">
        <template #error>
          <NuxtLayout />
        </template>
        <NuxtLayout />
      </NuxtErrorBoundary>
    </div>
  </div>
  <ClientOnly>
    <UiConfirmation />
    <UiMessages />
    <LazyChatShareModal />
    <LazySearchModal />
    <LazyNotificationPrompt />
    <Sidebar v-if="hasSidebar" />
    <LazyUiCursorGlow v-if="$device.isDesktop" />
    <LazyCookiesBanner />
  </ClientOnly>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'

// Nuxt Studio registers its own service worker at scope '/'
// (host.js: `navigator.serviceWorker.register('/sw.js?<version>')`), which
// competes with the @vite-pwa worker for the single scope-'/' registration.
// Each re-registration parks a fresh worker in `waiting`, latching
// `$pwa.needRefresh` to true, so the "app updated" prompt recurs on every
// /_studio visit and never clears. The Studio editor is only active for
// signed-in editors — its activation plugin populates the `studio-session`
// state — so suppress the (false) prompt in that case. Normal post-deploy
// update prompts for everyone else are unaffected.
const studioSession = useState<object | null>('studio-session', () => null)

const { siteName, description } = useAppConfig()

useHead({
  titleTemplate(titleChunk) {
    return titleChunk ? `${titleChunk} | ${siteName}` : `${siteName}`
  },
})

const { baseUrl } = useRuntimeConfig().public
const route = useRoute()
const hasSidebar = useHasSidebar()

// `baseUrl` is '' unless NUXT_PUBLIC_BASE_URL is set, and an empty base throws.
const siteOrigin = (baseUrl as string) || useRequestURL().origin

const canonicalUrl = computed<string>(() => {
  return buildCanonicalUrl(siteOrigin, route.path)
})

useSeoMeta({
  ogUrl: () => canonicalUrl.value,
  robots: 'index, follow',
  title: siteName,
  ogTitle: siteName,
  description: description as string,
  ogDescription: description as string,
  ogImage: buildCanonicalUrl(siteOrigin, '/og-image.png'),
  twitterCard: 'summary_large_image',
})

useHead({
  link: [
    { rel: 'canonical', href: () => canonicalUrl.value },
  ],
})

async function onException(exception: unknown) {
  const parsedException = parseError(exception)

  if (parsedException.status === 401) {
    const { fetchSession, session } = useAuth()

    // Bypass the cookie cache so a dead server session is detected here
    // instead of being masked by a still-cached get-session.
    await fetchSession({ disableCookieCache: true })

    if (!session.value) {
      await navigateTo('/signin')

      return
    }
  }

  useErrorMessage(
    parsedException.message || 'An unexpected error occurred.',
    parsedException.why,
  )
}
</script>
