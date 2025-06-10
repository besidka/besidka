<template>
  <div class="grid place-content-center h-svh">
    <UiBubble class="grid gap-4 max-w-xl px-8 text-center">
      <template v-if="error">
        <h1 class="text-4xl font-bold text-text">
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
