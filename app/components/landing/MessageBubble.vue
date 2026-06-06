<template>
  <div
    :id="id || undefined"
    class="chat scroll-mt-24"
    :class="role === 'assistant' ? 'chat-start' : 'chat-end'"
    role="doc-example"
    :aria-label="srLabel || undefined"
  >
    <div
      class="chat-image avatar rounded-full avatar-placeholder"
      :class="role === 'assistant' ? 'max-sm:hidden' : ''"
      aria-hidden="true"
    >
      <div
        class="bubble w-9 rounded-full bg-base-100 dark:bg-base-content/50
          text-text dark:text-base-100 shadow-none grid place-items-center"
      >
        <Logo v-if="role === 'assistant'" short class="size-5" />
        <Icon
          v-else
          name="lucide:user-round"
          class="size-5"
        />
      </div>
    </div>

    <div
      class="bubble chat-bubble shadow-none"
      :class="wide ? 'w-full' : 'max-w-[85%] sm:max-w-2xl'"
    >
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  role: 'assistant' | 'user'
  wide?: boolean
  srLabel?: string
  id?: string
}>(), {
  wide: false,
  srLabel: undefined,
  id: undefined,
})
</script>
