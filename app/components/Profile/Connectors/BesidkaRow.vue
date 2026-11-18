<template>
  <li
    class="list-row items-center gap-3 py-3"
    :class="{ 'bg-base-200': isSelected }"
    data-testid="besidka-connector-row"
  >
    <div
      class="avatar shrink-0"
      aria-hidden="true"
    >
      <div class="grid w-8 place-items-center rounded-full bg-base-200">
        <Logo
          short
          class="size-5"
        />
      </div>
    </div>
    <div class="list-col-grow min-w-0">
      <button
        v-if="isActive"
        type="button"
        class="link no-underline block w-full truncate rounded-box text-left font-medium"
        data-testid="besidka-connector-row-open"
        @click="emit('open')"
      >
        Besidka
      </button>
      <span
        v-else
        class="block w-full truncate font-medium"
        data-testid="besidka-connector-row-title"
      >
        Besidka
      </span>
      <p
        class="mt-1 text-xs text-base-content/70"
        data-testid="besidka-connector-row-description"
      >
        Let the model use your Besidka data and tools in chats, with your
        permission for each tool.
      </p>
    </div>
    <label class="flex items-center gap-2 text-sm">
      <span class="sr-only">Use Besidka tools in chats</span>
      <input
        type="checkbox"
        class="toggle toggle-sm"
        :checked="isActive"
        :disabled="isBusy"
        :aria-busy="isBusy"
        data-testid="besidka-connector-row-toggle"
        @change="onToggle"
      >
    </label>
  </li>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  isActive: boolean
  isBusy?: boolean
  isSelected?: boolean
}>(), {
  isBusy: false,
  isSelected: false,
})

const emit = defineEmits<{
  open: []
  toggle: [enabled: boolean]
}>()

function onToggle(event: Event) {
  const target = event.target as HTMLInputElement

  emit('toggle', target.checked)
  target.checked = props.isActive
}
</script>
