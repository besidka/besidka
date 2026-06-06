<template>
  <header class="sticky top-0 z-40 px-3 sm:px-4 pt-3">
    <nav
      class="bubble max-w-3xl mx-auto rounded-full px-4 sm:px-5 h-13
        flex items-center justify-between gap-4"
      aria-label="Main navigation"
    >
      <NuxtLink
        to="/"
        class="flex items-center gap-2 text-base-content
          hover:opacity-80 transition-opacity"
        aria-label="Besidka home"
      >
        <Logo class="h-7 w-auto" />
      </NuxtLink>

      <div
        class="hidden md:flex items-center gap-6 text-sm
          text-base-content/70"
        role="list"
      >
        <a
          href="#features"
          class="hover:text-accent transition-colors"
          role="listitem"
        >
          Features
        </a>
        <a
          href="#how-it-works"
          class="hover:text-accent transition-colors"
          role="listitem"
        >
          How it works
        </a>
        <a
          href="#faq"
          class="hover:text-accent transition-colors"
          role="listitem"
        >
          FAQ
        </a>
      </div>

      <div class="flex items-center gap-2">
        <SidebarThemeSwitcher tips tips-position="bottom" size="sm" />
        <NuxtLink
          :to="loggedIn ? '/chats/new' : '/signin'"
          class="btn btn-primary btn-sm min-h-9"
        >
          {{ loggedIn ? 'Open chats' : 'Sign in' }}
        </NuxtLink>
      </div>
    </nav>
  </header>
</template>

<script setup lang="ts">
const { loggedIn } = useAuth()
</script>
