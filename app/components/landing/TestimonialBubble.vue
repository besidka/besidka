<template>
  <LandingMessageBubble
    role="user"
    :avatar-src="avatarSrc"
    :sr-label="`Testimonial from ${author}`"
  >
    <blockquote class="not-italic">
      <slot />
      <footer class="mt-3 pt-3 border-t border-base-content/20">
        <cite class="not-italic text-sm text-base-content/60">
          <component
            :is="link ? 'a' : 'span'"
            v-if="link"
            :href="link"
            target="_blank"
            rel="noopener noreferrer"
            class="hover:text-accent transition-colors"
          >
            — {{ author }}<span v-if="role">, {{ role }}</span>
          </component>
          <span v-else>
            — {{ author }}<span v-if="role">, {{ role }}</span>
          </span>
        </cite>
      </footer>
    </blockquote>
  </LandingMessageBubble>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  author: string
  role?: string
  avatarSrc?: string
  link?: string
}>(), {
  role: undefined,
  avatarSrc: undefined,
  link: undefined,
})
</script>
