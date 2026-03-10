<template>
  <div
    ref="element"
    class="group w-screen sm:w-4xl sm:max-w-screen mx-auto"
  >
    <div
      class="px-4 sm:px-24"
    >
      <div
        class="relative chat"
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
        <div
          v-if="messageId && role === 'assistant'"
          class="fab absolute bottom-0 left-auto right-0"
        >
          <button
            type="button"
            data-tip="Branch from this message"
            class="tooltip tooltip-left btn btn-sm btn-ghost btn-circle"
            @click="emit('branch', messageId)"
          >
            <Icon name="lucide:git-branch" size="12" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { UIMessage } from 'ai'

withDefaults(defineProps<{
  role: UIMessage['role']
  hideAssistantAvatarOnMobile?: boolean
  messageId?: string
}>(), {
  hideAssistantAvatarOnMobile: true,
  messageId: undefined,
})

const emit = defineEmits<{
  branch: [messageId: string]
}>()

const { user } = useAuth()

const element = useTemplateRef<HTMLDivElement>('element')

defineExpose({
  element,
})
</script>
