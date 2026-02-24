<template>
  <div
    ref="element"
    class="chat w-screen sm:w-4xl sm:max-w-screen mx-auto px-4 sm:px-24"
    :class="{
      'chat-start': role === 'assistant',
      'chat-end': role === 'user',
    }"
  >
    <div
      class="chat-image avatar rounded-full"
      :class="{
        'avatar-placeholder':
          role === 'assistant' || !user?.image,
          'max-sm:hidden': hideAssistantAvatarOnMobile
            && role === 'assistant',
      }"
    >
      <div class="bubble w-9 rounded-full bg-base-100 dark:bg-base-content/50 text-text dark:text-base-100">
        <Logo
          v-if="role === 'assistant'"
          short
          class="size-5"
        />
        <template v-else>
          <img
            v-if="user?.image"
            :alt="user.name"
            :src="user.image"
          >
          <Icon v-else name="lucide:user-round" />
        </template>
      </div>
    </div>
    <div class="bubble chat-bubble shadow-none w-full">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { UIMessage } from 'ai'

withDefaults(defineProps<{
  role: UIMessage['role']
  hideAssistantAvatarOnMobile?: boolean
}>(), {
  hideAssistantAvatarOnMobile: true,
})

const { user } = useAuth()

const element = useTemplateRef<HTMLDivElement>('element')

defineExpose({
  element,
})
</script>
