<template>
  <a
    href="#content"
    class="sr-only focus:not-sr-only focus:absolute focus:top-2
      focus:left-2 focus:z-50 btn btn-accent !px-2"
  >
    Skip to main content
  </a>
  <LandingHeader />
  <main id="content">
    <NuxtPage />
  </main>
  <LandingFooter />
</template>
