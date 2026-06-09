<template>
  <a
    href="#content"
    class="sr-only focus:not-sr-only focus:absolute focus:top-2
      focus:left-2 focus:z-50 btn btn-accent !px-2"
  >
    Skip to main content
  </a>
  <LandingHeader />
  <main>
    <NuxtPage />
  </main>
  <LandingFooter />
</template>

<script setup lang="ts">
const { track } = useLandingAnalytics()

let headerObserver: ResizeObserver | null = null

// Expose the sticky header's real height so in-page anchor targets
// (.landing-anchor) can offset their scroll-margin by it and land just below
// the header rather than behind it. Measured live so it stays correct across
// viewports and any future header change.
function syncHeaderOffset(header: HTMLElement) {
  document.documentElement.style.setProperty(
    '--landing-header-offset',
    `${header.offsetHeight}px`,
  )
}

// Fire client-side so SWR/CDN-cached responses still produce accurate
// page-view counts — server-side rendering would undercount cached hits.
onMounted(() => {
  track('landing_page_view')

  const header = document.querySelector<HTMLElement>('header')

  if (!header) {
    return
  }

  syncHeaderOffset(header)

  headerObserver = new ResizeObserver(() => {
    return syncHeaderOffset(header)
  })
  headerObserver.observe(header)
})

onUnmounted(() => {
  headerObserver?.disconnect()
})
</script>
