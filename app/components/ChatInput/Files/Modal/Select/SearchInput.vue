<template>
  <label class="input grow input-sm">
    <Icon
      v-if="!isSearching"
      name="lucide:search"
      size="20"
      class="opacity-50"
    />
    <span
      v-else
      class="loading loading-spinner loading-xs"
    />
    <input
      ref="inputRef"
      :value="modelValue"
      type="text"
      class="grow"
      :placeholder="placeholder"
      @input="onInput"
    >
    <kbd
      v-if="
        !modelValue
          && !isSearching
          && showKeyboardHint
          && $device.isDesktop
      "
      class="kbd kbd-xs"
    >
      /
    </kbd>
    <button
      v-else-if="modelValue && !isSearching"
      type="button"
      class="btn btn-ghost btn-circle btn-xs"
      aria-label="Clear search"
      @click="clearSearch"
    >
      <Icon name="lucide:x" size="14" />
    </button>
  </label>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue: string
    isSearching: boolean
    placeholder?: string
    showKeyboardHint?: boolean
  }>(),
  {
    placeholder: 'Search files...',
    showKeyboardHint: true,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const inputRef = shallowRef<HTMLInputElement | null>(null)

function onInput(event: Event) {
  const target = event.target as HTMLInputElement
  emit('update:modelValue', target.value)
}

function clearSearch() {
  emit('update:modelValue', '')
}

defineExpose({
  inputRef,
})
</script>
