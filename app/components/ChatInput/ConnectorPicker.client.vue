<template>
  <Teleport to="body">
    <dialog
      ref="dialogRef"
      class="js-connector-picker modal modal-bottom sm:modal-middle"
      :aria-labelledby="headingId"
      data-testid="connector-picker-dialog"
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
              Connectors
            </h3>
            <p class="mt-1 text-sm text-base-content/70">
              Let the model use tools from the services you turn on for this
              chat
            </p>
          </div>
          <button
            type="button"
            class="btn btn-sm btn-circle btn-ghost"
            aria-label="Close"
            data-testid="connector-picker-close"
            @click="close"
          >
            <Icon
              name="lucide:x"
              size="18"
            />
          </button>
        </div>

        <div
          class="mb-3 flex shrink-0 flex-wrap gap-2"
          data-testid="connector-picker-actions"
        >
          <NuxtLink
            v-if="isRegistryAvailable"
            to="/chats/connectors?add=directory"
            class="btn btn-sm min-h-11 sm:min-h-8"
            data-testid="connector-picker-browse"
            @click="close"
          >
            <Icon
              name="lucide:search"
              size="16"
              aria-hidden="true"
            />
            Browse connectors
          </NuxtLink>
          <NuxtLink
            to="/chats/connectors"
            class="btn btn-sm min-h-11 sm:min-h-8"
            data-testid="connector-picker-manage"
            @click="close"
          >
            <Icon
              name="lucide:settings-2"
              size="16"
              aria-hidden="true"
            />
            Manage connectors
          </NuxtLink>
        </div>

        <div
          v-if="items.length >= 2"
          class="mb-3 flex shrink-0 flex-wrap items-center gap-2"
          data-testid="connector-picker-bulk"
        >
          <button
            type="button"
            class="btn btn-sm min-h-11 sm:min-h-8"
            :disabled="isSaving || !canTurnAllOn"
            data-testid="connector-picker-turn-all-on"
            @click="turnAllOn"
          >
            Turn all on
          </button>
          <button
            type="button"
            class="btn btn-sm min-h-11 sm:min-h-8"
            :disabled="isSaving || !canTurnAllOff"
            data-testid="connector-picker-turn-all-off"
            @click="turnAllOff"
          >
            Turn all off
          </button>
          <p
            class="sr-only"
            role="status"
            aria-live="polite"
          >
            {{ bulkNotice }}
          </p>
          <p
            v-if="bulkNotice"
            class="w-full text-xs text-warning"
            aria-hidden="true"
            data-testid="connector-picker-bulk-notice"
          >
            {{ bulkNotice }}
          </p>
        </div>

        <div
          class="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-box border border-base-200 p-1"
          data-testid="connector-picker-list-scroll"
        >
          <label
            v-if="besidka"
            class="flex w-full items-center gap-3 rounded-box px-3 py-2 hover:bg-base-200 max-sm:min-h-11"
            :class="besidka.isSaving ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'"
            data-testid="connector-picker-besidka"
          >
            <span
              class="grid size-8 shrink-0 place-items-center rounded-field bg-base-200"
              aria-hidden="true"
            >
              <Logo
                short
                class="size-5"
              />
            </span>
            <span class="flex min-w-0 grow flex-col">
              <span class="truncate text-sm font-medium">
                Besidka
              </span>
              <span class="truncate text-xs text-base-content/60">
                Your chats, projects, files and settings
              </span>
            </span>
            <input
              type="checkbox"
              class="toggle toggle-sm toggle-accent shrink-0"
              role="switch"
              :checked="besidka.enabled"
              :disabled="besidka.isSaving"
              aria-label="Use Besidka tools in this chat"
              data-testid="connector-picker-toggle-besidka"
              @change="emit('toggle-besidka')"
            >
          </label>
          <ul
            v-if="items.length"
            class="grid grid-cols-[minmax(0,1fr)] gap-0.5"
            data-testid="connector-picker-list"
          >
            <li
              v-for="item in items"
              :key="item.id"
            >
              <label
                class="flex w-full items-center gap-3 rounded-box px-3 py-2 hover:bg-base-200 max-sm:min-h-11"
                :class="isRowDisabled(item.id)
                  ? 'cursor-not-allowed opacity-60'
                  : 'cursor-pointer'
                "
              >
                <ProfileConnectorsAvatar
                  :title="item.title"
                  :connector-id="item.id"
                  :preset-id="item.presetId"
                  :is-icon-available="item.isIconAvailable"
                />
                <span class="flex min-w-0 grow flex-col">
                  <span class="truncate text-sm font-medium">
                    {{ item.title }}
                  </span>
                  <span class="truncate text-xs text-base-content/60">
                    {{ item.host }}
                  </span>
                </span>
                <span
                  v-if="item.status === 'drifted'"
                  class="badge badge-soft badge-warning badge-sm shrink-0"
                  :data-testid="`connector-picker-drifted-${item.slug}`"
                >
                  Tools changed
                </span>
                <input
                  type="checkbox"
                  class="toggle toggle-sm toggle-accent shrink-0"
                  role="switch"
                  :checked="isSelected(item.id)"
                  :disabled="isRowDisabled(item.id)"
                  :aria-label="`Use ${item.title} in this chat`"
                  :data-testid="`connector-picker-toggle-${item.slug}`"
                  @change="onToggle(item.id)"
                >
              </label>
            </li>
          </ul>
          <div
            v-else-if="!isLoaded"
            class="grid gap-2 p-2"
            aria-hidden="true"
            data-testid="connector-picker-skeleton"
          >
            <div class="skeleton skeleton--default h-10 w-full rounded-box" />
            <div class="skeleton skeleton--default h-10 w-full rounded-box" />
          </div>
          <div
            v-else
            class="px-6 py-10 text-center"
            data-testid="connector-picker-empty"
          >
            <Icon
              name="lucide:cable"
              size="36"
              class="mx-auto mb-3 opacity-60"
            />
            <p class="font-medium">
              No connectors yet
            </p>
            <p class="mt-1 text-sm text-base-content/70">
              Add a connector, then turn it on here.
            </p>
            <NuxtLink
              to="/chats/connectors?add=presets"
              class="btn btn-primary btn-sm mt-4 min-h-11 sm:min-h-8"
              data-testid="connector-picker-add"
              @click="close"
            >
              Add a connector
            </NuxtLink>
          </div>
        </div>
        <p
          class="mt-3 shrink-0 text-xs"
          :class="isAtLimit ? 'text-warning' : 'text-base-content/60'"
          data-testid="connector-picker-limit-hint"
        >
          {{ limitHint }}
        </p>
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
import { CONNECTORS_PER_SEND } from '#shared/utils/connectors-policy'
import { planTurnAllOn } from '~/composables/composer-connectors'
import type { ComposerConnectorItem } from '~/composables/composer-connectors'

const props = withDefaults(defineProps<{
  items: ComposerConnectorItem[]
  selectedIds: string[]
  isAtLimit: boolean
  isSaving: boolean
  besidka?: { enabled: boolean, isSaving: boolean } | null
  isLoaded?: boolean
  isRegistryAvailable?: boolean
}>(), {
  besidka: null,
  isLoaded: true,
  isRegistryAvailable: false,
})

const emit = defineEmits<{
  'toggle': [connectorId: string]
  'set-all': [connectorIds: string[]]
  'toggle-besidka': []
}>()

const isOpen = defineModel<boolean>('open', { default: false })

const DIALOG_READY_TIMEOUT_MS = 1000

const headingId = useId()
const dialogRef = useTemplateRef<HTMLDialogElement>('dialogRef')
const boxRef = useTemplateRef<HTMLDivElement>('boxRef')

const bulkNotice = shallowRef<string>('')

const itemIds = computed<string[]>(() => {
  return props.items.map(item => item.id)
})

const selectedItemCount = computed<number>(() => {
  return itemIds.value.filter(id => props.selectedIds.includes(id)).length
})

const canTurnAllOn = computed<boolean>(() => {
  return planTurnAllOn(itemIds.value, props.selectedIds).ids.length
    > selectedItemCount.value
})

const canTurnAllOff = computed<boolean>(() => {
  return selectedItemCount.value > 0
})

const limitHint = computed<string>(() => {
  if (props.isAtLimit) {
    return `${CONNECTORS_PER_SEND} connectors are on. Turn one off to use `
      + 'another.'
  }

  return `Up to ${CONNECTORS_PER_SEND} at once`
})

function turnAllOn() {
  const plan = planTurnAllOn(itemIds.value, props.selectedIds)

  bulkNotice.value = plan.skippedCount > 0
    ? `${plan.ids.length} of ${props.items.length} are on. At most `
    + `${CONNECTORS_PER_SEND} can be on at once.`
    : ''
  emit('set-all', plan.ids)
}

function turnAllOff() {
  bulkNotice.value = ''
  emit('set-all', [])
}

function onToggle(connectorId: string) {
  bulkNotice.value = ''
  emit('toggle', connectorId)
}

function isSelected(connectorId: string): boolean {
  return props.selectedIds.includes(connectorId)
}

function isRowDisabled(connectorId: string): boolean {
  return props.isSaving || (props.isAtLimit && !isSelected(connectorId))
}

async function showDialog() {
  const dialog = await until(dialogRef).toBeTruthy({
    timeout: DIALOG_READY_TIMEOUT_MS,
    throwOnTimeout: false,
  })

  if (!dialog || dialog.open) {
    return
  }

  dialog.showModal()
  boxRef.value?.focus({ preventScroll: true })
}

watch(isOpen, async (open) => {
  if (!open) {
    bulkNotice.value = ''

    if (dialogRef.value?.open) {
      dialogRef.value.close()
    }

    return
  }

  await showDialog()
}, { immediate: true, flush: 'post' })

function close() {
  isOpen.value = false
}

function onDialogClose() {
  isOpen.value = false
}
</script>
