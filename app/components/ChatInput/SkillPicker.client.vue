<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="js-skill-picker modal modal-bottom sm:modal-middle"
      :aria-labelledby="headingId"
      data-testid="skill-picker-dialog"
      @close="onDialogClose"
    >
      <div
        ref="boxRef"
        tabindex="-1"
        autofocus
        class="modal-box sheet-safe-padding flex max-w-2xl flex-col outline-none max-sm:h-[85dvh] sm:max-h-[80dvh]"
      >
        <div class="mb-4 flex shrink-0 items-start justify-between gap-3">
          <div>
            <h3
              :id="headingId"
              class="text-lg font-bold"
            >
              Add skill
            </h3>
            <p class="mt-1 text-sm text-base-content/70">
              Attach one skill to your next message
            </p>
          </div>
          <button
            type="button"
            class="btn btn-sm btn-circle btn-ghost"
            aria-label="Close"
            data-testid="skill-picker-close"
            @click="close"
          >
            <Icon
              name="lucide:x"
              size="18"
            />
          </button>
        </div>

        <div
          ref="searchWrapRef"
          class="shrink-0"
        >
          <UiSearchInput
            ref="searchInputRef"
            v-model="search"
            :is-searching="false"
            placeholder="Search skills..."
            :show-keyboard-hint="false"
            class="input-sm sm:input-md"
          />
        </div>

        <div
          class="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-box border border-base-200 p-1"
          data-testid="skill-picker-list-scroll"
        >
          <ul
            v-if="visibleItems.length"
            class="grid gap-0.5"
            data-testid="skill-picker-list"
          >
            <li
              v-for="item in visibleItems"
              :key="item.id"
            >
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-box px-3 py-2 text-left cursor-pointer hover:bg-base-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent max-sm:min-h-11"
                :aria-pressed="selectedId === item.id"
                :data-testid="`skill-picker-item-${item.name}`"
                @click="onPick(item)"
              >
                <Icon
                  name="lucide:sparkles"
                  size="16"
                  class="shrink-0 opacity-75"
                  aria-hidden="true"
                />
                <span class="flex min-w-0 grow flex-col">
                  <span class="truncate text-sm font-medium">
                    {{ item.name }}
                  </span>
                  <span class="truncate text-xs text-base-content/60">
                    {{ item.description }}
                  </span>
                </span>
                <span class="badge badge-soft badge-sm shrink-0">
                  {{ SKILL_MODE_LABELS[item.mode] }}
                </span>
                <Icon
                  v-if="selectedId === item.id"
                  name="lucide:check"
                  size="14"
                  class="shrink-0 text-accent"
                  aria-hidden="true"
                />
              </button>
            </li>
          </ul>
          <div
            v-else
            class="px-6 py-10 text-center"
            data-testid="skill-picker-empty"
          >
            <Icon
              name="lucide:search-x"
              size="36"
              class="mx-auto mb-3 opacity-60"
            />
            <p class="font-medium">
              {{ search ? `Nothing matches "${search.trim()}"` : 'No skills' }}
            </p>
            <button
              v-if="search"
              type="button"
              class="btn btn-sm mt-4"
              data-testid="skill-picker-clear"
              @click="search = ''"
            >
              Clear
            </button>
          </div>
        </div>
      </div>
      <form
        method="dialog"
        class="modal-backdrop"
      >
        <button aria-label="Close">
          close
        </button>
      </form>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import { SKILL_MODE_LABELS } from '#shared/utils/skills/mode'
import type { ComposerSkillItem } from '~/composables/composer-skills'

const props = defineProps<{
  items: ComposerSkillItem[]
  selectedId: string | null
}>()

const emit = defineEmits<{
  pick: [item: ComposerSkillItem]
}>()

const isOpen = defineModel<boolean>('open', { default: false })

interface SearchInputInstance {
  inputRef: HTMLInputElement | null
}

const DIALOG_READY_TIMEOUT_MS = 1000

const { isDesktop } = useDevice()
const headingId = useId()
const dialogRef = useTemplateRef<HTMLDialogElement>('dialogRef')
const boxRef = useTemplateRef<HTMLDivElement>('boxRef')
const searchWrapRef = useTemplateRef<HTMLDivElement>('searchWrapRef')
const searchInputRef = shallowRef<SearchInputInstance | null>(null)
const search = shallowRef<string>('')

const visibleItems = computed<ComposerSkillItem[]>(() => {
  const term = search.value.trim().toLowerCase()

  if (!term) {
    return props.items
  }

  return props.items.filter((item) => {
    return item.name.toLowerCase().includes(term)
      || item.description.toLowerCase().includes(term)
  })
})

async function showDialog() {
  const dialog = await until(dialogRef).toBeTruthy({
    timeout: DIALOG_READY_TIMEOUT_MS,
    throwOnTimeout: false,
  })

  if (!dialog || dialog.open) {
    return
  }

  const searchWrap = searchWrapRef.value

  if (searchWrap) {
    searchWrap.inert = true
  }

  dialog.showModal()
  boxRef.value?.focus({ preventScroll: true })

  if (searchWrap) {
    searchWrap.inert = false
  }

  if (isDesktop) {
    searchInputRef.value?.inputRef?.focus({ preventScroll: true })
  }
}

watch(isOpen, async (open) => {
  if (!open) {
    if (dialogRef.value?.open) {
      dialogRef.value.close()
    }

    return
  }

  search.value = ''
  await showDialog()
}, { immediate: true, flush: 'post' })

function close() {
  isOpen.value = false
}

function onDialogClose() {
  isOpen.value = false
}

function onPick(item: ComposerSkillItem) {
  emit('pick', item)
  close()
}
</script>
