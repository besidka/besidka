<template>
  <div class="grid grid-rows-[1fr_auto] h-screen">
    <div class="grow"/>
    <div class="grid place-content-center">
      <UiBubble class="!rounded-b-none !rounded-t-[calc(var(--radius-xl)_+_var(--spacing)_*_2)] !pb-0 z-50">
        <div class="p-1 pb-0 rounded-t-xl bg-base-100/30 dark:bg-base-100/80 shadow-lg">
          <textarea
            class="textarea textarea-ghost !bg-transparent w-lg max-w-full h-12 resize-none rounded-[calc(var(--radius-field))]"
            placeholder="Type your message here..."
          />
          <div class="p-2">
            <select class="select select-ghost select-xs !bg-transparent">
              <option>GPT-4</option>
              <option>Claude</option>
              <option>Llama</option>
            </select>
          </div>
        </div>
      </UiBubble>
    </div>
  </div>
</template>
<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
})

useSeoMeta({
  title: 'Home',
})
</script>
