<template>
  <details
    ref="dropdown"
    class="dropdown dropdown-top dropdown-start"
  >
    <summary
      data-testid="files-trigger"
      class="indicator indicator-top indicator-end btn btn-xs btn-accent btn-ghost btn-ghost-legacy btn-circle"
      :class="{ 'btn-active': files.length > 0 || isDropdownHovered }"
      aria-label="Attach files"
    >
      <Icon name="lucide:paperclip" :size="16" />
      <span
        v-if="files.length"
        class="indicator-item badge badge-accent badge-xs size-4 p-0 rounded-full text-[.5rem]"
      >
        {{ files.length }}
      </span>
    </summary>
    <ClientOnly>
      <div class="dropdown-content z-50 w-48 pb-2">
        <div class="bg-base-100 rounded-box w-full shadow-sm">
          <ul class="menu menu-xs w-full">
            <li>
              <button
                data-testid="files-open-select"
                type="button"
                @click="openModal('select')"
              >
                <Icon name="lucide:file-check" size="16" />
                Select existing files
              </button>
            </li>
            <li>
              <button
                data-testid="files-open-upload"
                type="button"
                @click="openModal('upload')"
              >
                <Icon name="lucide:cloud-upload" size="16" />
                Upload new files
              </button>
            </li>
            <li
              :class="{
                'menu-disabled': !files.length
              }"
            >
              <button
                type="button"
                class="flex w-full justify-start text-error disabled:opacity-50"
                :disabled="files.length ? undefined : true"
                @click="onDetachAllFiles"
              >
                <span class="flex items-center gap-2 grow">
                  <Icon name="lucide:file-x-corner" size="16" />
                  Detach all files
                </span>
                <span
                  v-if="files.length"
                  class="indicator-item badge badge-error badge-xs text-[.5rem]"
                >
                  {{ files.length }}
                </span>
              </button>
            </li>
          </ul>
        </div>
      </div>
    </ClientOnly>
  </details>
</template>

<script setup lang="ts">
import type { FileMetadata } from '#shared/types/files.d'

defineProps<{
  files: FileMetadata[]
}>()

const emit = defineEmits<{
  detachAll: []
  open: [tab: 'select' | 'upload']
}>()

const { isIos, isAndroid } = useDevice()

const dropdown = useTemplateRef<HTMLDetailsElement>('dropdown')

const isDropdownHovered = useElementHover(dropdown)

onClickOutside(dropdown, () => {
  if (dropdown.value?.open) {
    dropdown.value.open = false
  }
})

watch(isDropdownHovered, (hovered) => {
  if (!dropdown.value || isIos || isAndroid) {
    return
  }

  dropdown.value.open = hovered
}, {
  immediate: false,
  flush: 'post',
})

function closeDropdown() {
  if (dropdown.value?.open) {
    dropdown.value.open = false
  }
}

function openModal(tab: 'select' | 'upload') {
  closeDropdown()
  emit('open', tab)
}

async function onDetachAllFiles() {
  const result = await useConfirm({
    text: 'Are you sure you want to detach all files?',
    actions: ['Confirm'],
  })

  if (!result) return

  emit('detachAll')
  closeDropdown()
}
</script>
