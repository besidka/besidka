<template>
  <li
    class="list-row relative items-center gap-3 py-3 transition-colors"
    :class="rowStateClass"
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
      <div class="flex min-w-0 items-center gap-2">
        <button
          v-if="isActive"
          type="button"
          class="link no-underline block min-w-0 cursor-pointer truncate text-left font-medium after:absolute after:inset-0 after:rounded-box after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-primary"
          data-testid="besidka-connector-row-open"
          @click="emit('open')"
        >
          Besidka
        </button>
        <span
          v-else
          class="block min-w-0 truncate font-medium"
          data-testid="besidka-connector-row-title"
        >
          Besidka
        </span>
        <span
          class="badge badge-soft badge-sm shrink-0"
          data-testid="besidka-connector-row-badge"
        >
          Built in
        </span>
      </div>
      <p
        class="mt-1 text-xs text-base-content/70"
        data-testid="besidka-connector-row-description"
      >
        Let the model use your Besidka data and tools in chats, with your
        permission for each tool.
      </p>
    </div>
    <label class="relative z-10 flex items-center gap-2 text-sm">
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

const rowStateClass = computed<string>(() => {
  if (props.isSelected) {
    return 'bg-base-200'
  }

  return props.isActive ? 'hover:bg-base-200/60' : ''
})

function onToggle(event: Event) {
  const target = event.target as HTMLInputElement

  emit('toggle', target.checked)
  target.checked = props.isActive
}
</script>
