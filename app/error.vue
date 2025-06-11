<template>
  <div class="grid place-items-center w-full min-h-svh p-4">
    <div class="grid place-items-center w-full">
      <div class="grid place-items-center mb-8">
        <Logo class="min-h-auto !m-0" />
      </div>
      <UiBubble class="grow sm:w-md max-w-full p-8 text-center z-20">
        <template v-if="error">
          <h1 class="mb-2 text-4xl font-bold text-text">
            Error code: {{ error.statusCode }}
          </h1>
          <h2 class="text-xl font-medium">
            {{ error.message }}
          </h2>
        </template>
        <h1
          v-else
          class="text-4xl font-bold text-text"
        >
          Something went wrong :(
        </h1>
        <div
          class="tooltip tooltip-bottom mt-4"
          data-tip="Return to the home page"
        >
          <button
            type="button"
            class="btn btn-primary"
            aria-label="Go back home"
            @click="navigateTo('/')"
          >
            Go back home
          </button>
        </div>
      </UiBubble>
    </div>
  </div>
  <div class="fixed top-8 right-8 z-20">
    <ThemeSwitcher
      :tips="true"
      tips-position="left"
    />
  </div>
  <LazyUiCursorGlow v-if="$device.isDesktop" />
</template>

<script setup lang="ts">
import type { NuxtError } from '#app'

defineProps({
  error: {
    type: Object as () => NuxtError,
    default: null,
  },
})
</script>
