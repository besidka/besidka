<template>
  <div
    role="status"
    class="alert alert-soft alert-warning !items-start"
    data-testid="knowledge-item-injection-review"
  >
    <Icon
      name="lucide:shield-alert"
      size="20"
      class="mt-0.5 shrink-0"
    />
    <div class="grid min-w-0 gap-2">
      <p class="break-words font-bold">
        Possible prompt injection, review it
      </p>
      <p class="break-words text-sm">
        TypeSafe AI found text in this item that may try to give the AI model
        instructions you did not write. Until you allow it, Besidka leaves it
        out of your chats. Nothing was deleted.
      </p>
      <p class="break-words text-sm">
        Allow it if you trust the source, for example your own notes or
        instructions.
      </p>
      <div>
        <UiButton
          mode="warning"
          outline
          size="sm"
          icon-name="lucide:check"
          :text="isAllowing ? 'Allowing...' : 'Allow anyway'"
          normal-case
          :disabled="isAllowing || disabled"
          data-testid="knowledge-item-allow"
          @click="emit('allow')"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  isAllowing: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  allow: []
}>()
</script>
