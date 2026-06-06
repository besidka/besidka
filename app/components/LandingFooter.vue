<template>
  <footer class="px-3 sm:px-4 pb-8 pt-2">
    <div class="bubble max-w-3xl mx-auto rounded-2xl px-6 py-8">
      <div class="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-8">
        <div class="flex flex-col gap-3 col-span-1 sm:col-span-4">
          <NuxtLink
            to="/"
            class="flex items-center gap-2 text-base-content
              hover:opacity-80 transition-opacity self-start"
            aria-label="Besidka home"
          >
            <Logo class="h-7 w-auto" />
          </NuxtLink>
          <p class="text-sm text-base-content/60 max-w-xs leading-relaxed">
            Your digital besidka for all AI chats. Bring your API key.
            Open-source and private.
          </p>
        </div>

        <div class="flex flex-col gap-3">
          <h3
            class="text-sm font-semibold text-base-content uppercase
              tracking-wide"
          >
            Product
          </h3>
          <nav class="flex flex-col gap-2" aria-label="Product links">
            <a
              href="#features"
              class="text-sm text-base-content/60 hover:text-accent
                transition-colors"
            >
              Features
            </a>
            <a
              href="#faq"
              class="text-sm text-base-content/60 hover:text-accent
                transition-colors"
            >
              FAQ
            </a>
          </nav>
        </div>

        <div class="flex flex-col gap-3">
          <h3
            class="text-sm font-semibold text-base-content uppercase
              tracking-wide"
          >
            Legal
          </h3>
          <nav class="flex flex-col gap-2" aria-label="Legal links">
            <NuxtLink
              to="/terms"
              class="text-sm text-base-content/60 hover:text-accent
                transition-colors"
            >
              Terms of Service
            </NuxtLink>
            <NuxtLink
              to="/privacy"
              class="text-sm text-base-content/60 hover:text-accent
                transition-colors"
            >
              Privacy Policy
            </NuxtLink>
          </nav>
        </div>

        <div class="flex flex-col gap-3">
          <h3
            class="text-sm font-semibold text-base-content uppercase
              tracking-wide"
          >
            Open Source
          </h3>
          <div class="flex flex-col gap-2">
            <address class="not-italic">
              <a
                href="https://github.com/besidka/besidka"
                target="_blank"
                rel="noopener noreferrer"
                class="text-sm text-base-content/60 hover:text-accent
                  transition-colors"
              >
                GitHub
              </a>
            </address>
            <p class="text-sm text-base-content/60">
              MIT License
            </p>
            <LandingGithubStarsBadge :show-label="false" class="self-start" />
          </div>
        </div>
      </div>

      <div
        class="mt-10 pt-6 border-t border-base-300 flex flex-col sm:flex-row
          items-center justify-between gap-2 text-xs text-base-content/40"
      >
        <p>© {{ year }} Besidka. All rights reserved.</p>
        <p>Made with care for the open-source community.</p>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
const year = new Date().getFullYear()
</script>
