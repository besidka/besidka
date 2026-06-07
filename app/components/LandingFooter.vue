<template>
  <footer class="px-3 sm:px-4 pb-8 pt-2">
    <div class="bubble max-w-3xl mx-auto rounded-2xl px-6 py-8">
      <div class="grid items-start grid-cols-1 sm:grid-cols-3 gap-8">

        <div class="flex flex-col gap-3 sm:col-span-3 md:col-span-2 max-md:items-center">
          <NuxtLink
            to="/"
            class="btn btn-ghost btn-sm md:self-start -translate-x-4 rounded-full"
            aria-label="Besidka home"
          >
            <Logo class="h-7 w-auto" />
          </NuxtLink>
          <p class="text-sm text-base-content/70 max-w-xs leading-relaxed max-md:text-center">
            Your digital besidka for all AI chats. Bring your API key.
            Open-source and private.
          </p>
        </div>

        <div class="flex items-center justify-center md:justify-end sm:max-md:col-span-3 gap-3">
          <a
            href="https://www.linkedin.com/company/besidka"
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn-ghost btn-circle"
            aria-label="Besidka on LinkedIn"
            @click="track('footer_link_click', {
              target: 'linkedin',
            })"
          >
            <Icon
              name="streamline-logos:linkedin-logo-block"
              size="24"
              aria-hidden="true"
            />
            <span class="sr-only">(opens in new tab)</span>
          </a>
          <a
            href="https://x.com/besidka_ai"
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn-ghost btn-circle"
            aria-label="Besidka on X (formerly Twitter)"
            @click="track('footer_link_click', { target: 'twitter' })"
          >
            <Icon
              name="streamline-logos:twitter-logo-1-solid"
              size="24"
              aria-hidden="true"
            />
            <span class="sr-only">(opens in new tab)</span>
          </a>
          <a
            href="https://github.com/besidka/besidka"
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn-ghost btn-circle"
            aria-label="Besidka on GitHub"
            @click="track('footer_link_click', { target: 'github' })"
          >
            <Icon
              name="streamline-logos:github-logo-2-solid"
              size="24"
              aria-hidden="true"
            />
            <span class="sr-only">(opens in new tab)</span>
          </a>
        </div>

        <div class="flex flex-col gap-3 max-sm:items-center">
          <h3
            class="text-sm font-black text-base-content uppercase
              tracking-wide"
          >
            Product
          </h3>
          <nav
            class="flex flex-col gap-2 max-sm:items-center"
            aria-label="Product links"
          >
            <a
              href="#features"
              class="link link-hover text-sm"
              @click="track('footer_link_click', { target: '#features' })"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              class="link link-hover text-sm"
              @click="track('footer_link_click', {
                target: '#how-it-works',
              })"
            >
              How it works
            </a>
            <a
              href="#faq"
              class="link link-hover text-sm"
              @click="track('footer_link_click', { target: '#faq' })"
            >
              FAQ
            </a>
          </nav>
        </div>

        <div class="flex flex-col gap-3 max-sm:items-center">
          <h3
            class="text-sm font-black text-base-content uppercase
              tracking-wide"
          >
            Legal
          </h3>
          <nav
            aria-label="Legal links"
            class="flex flex-col gap-2 max-sm:items-center"
          >
            <NuxtLink
              to="/terms"
              class="link link-hover text-sm"
            >
              Terms of Service
            </NuxtLink>
            <NuxtLink
              to="/privacy"
              class="link link-hover text-sm"
            >
              Privacy Policy
            </NuxtLink>
          </nav>
        </div>

        <div class="flex flex-col gap-3 max-sm:items-center">
          <h3
            class="text-sm font-black text-base-content uppercase
              tracking-wide"
          >
            Open Source
          </h3>
          <div class="flex flex-col gap-2 max-sm:items-center">
            <address class="not-italic">
              <a
                href="https://github.com/besidka/besidka"
                target="_blank"
                rel="noopener noreferrer"
                class="link link-hover text-sm"
                @click="track('footer_link_click', { target: 'github' })"
              >
                GitHub
                <span class="sr-only">(opens in new tab)</span>
              </a>
            </address>
            <p class="text-sm text-base-content/70">
              MIT License
            </p>
            <LandingGithubStarsBadge :show-label="false" class="self-start" />
          </div>
        </div>
      </div>

      <div
        class="mt-10 pt-6 border-t border-base-300 flex flex-col sm:flex-row
          items-center justify-between gap-2 text-xs text-base-content/70"
      >
        <p>© {{ year }} Besidka. All rights reserved.</p>
        <p class="text-center">Made with care for the open-source community.</p>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
const year = useState('footer-year', () => new Date().getFullYear())
const { track } = useLandingAnalytics()
</script>
