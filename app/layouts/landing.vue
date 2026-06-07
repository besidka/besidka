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

// Fire client-side so SWR/CDN-cached responses still produce accurate
// page-view counts — server-side rendering would undercount cached hits.
onMounted(() => {
  track('landing_page_view')
})
</script>
