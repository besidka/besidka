<template>
  <article
    class="grid gap-4 py-4 text-sm leading-relaxed"
    data-testid="side-panel-demo-body"
  >
    <label class="grid gap-1">
      <span class="text-xs text-base-content/70">Note</span>
      <input
        type="text"
        class="input input-sm w-full"
        placeholder="Type to check the on-screen keyboard"
        data-testid="side-panel-demo-input"
      >
    </label>
    <p
      v-for="paragraph in paragraphs"
      :key="paragraph"
    >
      {{ paragraph }}. Lorem ipsum dolor sit amet, consectetur adipiscing
      elit, sed do eiusmod tempor incididunt ut labore et dolore magna
      aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco
      laboris nisi ut aliquip ex ea commodo consequat.
    </p>
  </article>
</template>

<script setup lang="ts">
const PARAGRAPH_COUNT = 24

const paragraphs = Array.from({ length: PARAGRAPH_COUNT }, (_, index) => {
  return `Paragraph ${index + 1}`
})
</script>
