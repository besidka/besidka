<template>
  <label class="input input-sm w-full">
    <Icon
      name="lucide:search"
      size="14"
      class="opacity-50"
    />
    <input
      ref="input"
      v-model="query"
      type="text"
      data-testid="models-picker-search"
      aria-label="Search models"
      placeholder="Search models"
      autocomplete="off"
      spellcheck="false"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded="true"
      :aria-controls="controls"
      :aria-activedescendant="activeDescendant"
      @keydown="emit('keydown', $event)"
    >
    <button
      v-if="query"
      type="button"
      class="btn btn-ghost btn-xs btn-circle -mr-2"
      aria-label="Clear search"
      @click="clear"
    >
      <Icon
        name="lucide:x"
        size="12"
      />
    </button>
  </label>
</template>

<script setup lang="ts">
const props = defineProps<{
  autofocus?: boolean
  controls?: string
  activeDescendant?: string
}>()

const emit = defineEmits<{
  keydown: [event: KeyboardEvent]
}>()

const query = defineModel<string>({ default: '' })
const input = useTemplateRef<HTMLInputElement>('input')

function clear() {
  query.value = ''
  input.value?.focus()
}

onMounted(() => {
  if (!props.autofocus) {
    return
  }

  input.value?.focus()
})
</script>
