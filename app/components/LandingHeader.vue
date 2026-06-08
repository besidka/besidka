<template>
  <header class="sticky top-0 z-40 px-3 sm:px-4 pt-3">
    <nav
      class="bubble max-w-3xl mx-auto rounded-full px-4 sm:px-5 h-13
        flex items-center justify-between gap-4"
      aria-label="Main navigation"
    >
      <NuxtLink
        to="/"
        class="btn btn-sm btn-ghost -translate-x-4 rounded-full"
        aria-label="Besidka home"
      >
        <Logo class="h-7 w-auto" />
      </NuxtLink>

      <ul
        class="hidden md:flex items-center gap-6 text-sm
          list-none m-0 p-0"
      >
        <li>
          <a
            href="#features"
            class="link link-hover text-sm"
          >
            Features
          </a>
        </li>
        <li>
          <a
            href="#how-it-works"
            class="link link-hover text-sm"
          >
            How it works
          </a>
        </li>
        <li>
          <a
            href="#faq"
            class="link link-hover text-sm"
          >
            FAQ
          </a>
        </li>
      </ul>

      <div class="flex items-center gap-2 translate-x-3">
        <SidebarThemeSwitcher tips tips-position="bottom" size="sm" />
        <NuxtLink
          v-if="loggedIn"
          to="/chats/new"
          class="group/cta btn btn-accent btn-sm rounded-full"
          @click="track('header_cta_click', { target: '/chats/new' })"
        >
          New chat
          <Icon
            name="lucide:message-circle-plus"
            size="16"
            class="cta-icon"
            aria-hidden="true"
          />
        </NuxtLink>
        <NuxtLink
          v-else
          to="/signup"
          class="btn btn-accent btn-sm rounded-full"
          @click="track('header_cta_click', { target: '/signup' })"
        >
          Get started
          <Icon
            name="lucide:user-plus"
            size="16"
            class="cta-icon"
            aria-hidden="true"
          />
        </NuxtLink>
      </div>
    </nav>
  </header>
</template>

<script setup lang="ts">
const { loggedIn } = useAuth()
const { track } = useLandingAnalytics()
</script>
