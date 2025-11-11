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
      <div
        class="w-10 rounded-full bg-base-100 text-text"
        :class="{
          'dark:bg-base-content/50 dark:text-base-100': role === 'assistant'
        }"
      >
        <Logo
          v-if="role === 'assistant'"
          short
          class="size-6"
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
    <div class="bubble chat-bubble sm:px-6 shadow-none w-full">
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
