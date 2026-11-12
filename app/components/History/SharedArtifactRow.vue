<template>
  <li
    class="
      list-row items-center gap-3 group py-3 sm:py-2 relative
      [&:has(details[open])]:z-30
    "
    data-testid="shared-artifact-row"
    :data-artifact-id="artifact.id"
  >
    <div class="list-col-grow flex-1 min-w-0">
      <NuxtLink
        :to="openLink"
        class="link no-underline rounded-box block w-full truncate py-1 font-medium"
        data-testid="shared-artifact-row-open"
      >
        {{ artifact.title }}
      </NuxtLink>
      <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-base-content/70">
        <span
          class="badge badge-soft badge-sm gap-1"
          data-testid="shared-artifact-row-kind"
        >
          <Icon
            :name="ARTIFACT_KIND_ICONS[artifact.kind]"
            size="10"
            aria-hidden="true"
          />
          {{ ARTIFACT_KIND_LABELS[artifact.kind] }}
        </span>
        <span data-testid="shared-artifact-row-links">
          {{ formatActiveLinkCount(artifact.activeShareCount) }}
        </span>
        <span data-testid="shared-artifact-row-expiry">
          <template v-if="artifact.nearestExpiresAt">
            Next expiry
            <UiLocalDate
              :value="artifact.nearestExpiresAt"
              with-time
            />
          </template>
          <template v-else>
            No expiry
          </template>
        </span>
      </div>
    </div>

    <span
      v-if="isBusy"
      class="loading loading-spinner loading-xs"
      aria-hidden="true"
    />
    <details
      v-else
      ref="dropdownRef"
      class="
        dropdown dropdown-end relative z-20 open:z-40
        transition-opacity
        sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100
      "
      :class="isFlippedUp ? 'dropdown-top' : 'dropdown-bottom'"
      @toggle="updatePlacement"
    >
      <summary
        data-testid="shared-artifact-row-actions-trigger"
        class="btn btn-ghost btn-sm sm:btn-xs btn-circle"
        aria-label="Shared artifact actions"
      >
        <Icon
          name="lucide:ellipsis-vertical"
          size="16"
        />
      </summary>
      <div
        class="dropdown-content z-50 w-64"
        :class="isFlippedUp ? 'pb-2' : 'pt-2'"
        data-testid="shared-artifact-row-actions-menu"
      >
        <ul
          tabindex="0"
          class="menu menu-sm bg-base-100 rounded-box shadow-lg w-64 p-1"
        >
          <li>
            <NuxtLink
              :to="openLink"
              data-testid="shared-artifact-action-open"
              @click="closeDropdown"
            >
              <Icon
                name="lucide:panel-right-open"
                size="14"
              />
              Open
            </NuxtLink>
          </li>
          <li>
            <button
              type="button"
              data-testid="shared-artifact-action-copy"
              @click="onCopy"
            >
              <Icon
                name="lucide:copy"
                size="14"
              />
              Copy link
            </button>
          </li>
          <li>
            <button
              type="button"
              data-testid="shared-artifact-action-manage"
              @click="onManage"
            >
              <Icon
                name="lucide:share-2"
                size="14"
              />
              Manage…
            </button>
          </li>
          <li>
            <button
              type="button"
              class="text-error"
              data-testid="shared-artifact-action-revoke"
              @click="onRevoke"
            >
              <Icon
                name="lucide:link-2-off"
                size="14"
              />
              Revoke all
            </button>
          </li>
        </ul>
      </div>
    </details>
  </li>
</template>

<script setup lang="ts">
import type { SharedArtifactSummary } from '#shared/utils/artifacts'
import {
  ARTIFACT_KIND_ICONS,
  ARTIFACT_KIND_LABELS,
} from '~/utils/artifact-parts'

const props = withDefaults(
  defineProps<{
    artifact: SharedArtifactSummary
    isBusy?: boolean
  }>(),
  {
    isBusy: false,
  },
)

const emit = defineEmits<{
  copy: [artifact: SharedArtifactSummary]
  manage: [artifact: SharedArtifactSummary]
  revoke: [artifact: SharedArtifactSummary]
}>()

const dropdownRef = useTemplateRef<HTMLDetailsElement>('dropdownRef')
const { isFlippedUp, updatePlacement } = useDropdownPlacement(dropdownRef)

const openLink = computed<string>(() => {
  return `/chats/artifacts?artifact=${encodeURIComponent(props.artifact.id)}`
})

onClickOutside(dropdownRef, () => {
  if (dropdownRef.value?.open) {
    closeDropdown()
  }
})

function closeDropdown() {
  if (dropdownRef.value) {
    dropdownRef.value.open = false
    const activeElement = document.activeElement as HTMLElement | null

    activeElement?.blur()
  }
}

function onCopy() {
  closeDropdown()
  emit('copy', props.artifact)
}

function onManage() {
  closeDropdown()
  emit('manage', props.artifact)
}

function onRevoke() {
  closeDropdown()
  emit('revoke', props.artifact)
}
</script>
