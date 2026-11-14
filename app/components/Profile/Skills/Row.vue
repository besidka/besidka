<template>
  <li
    class="
      list-row items-center gap-3 group py-3 sm:py-2 relative
      [&:has(details[open])]:z-30
    "
    :class="{ 'bg-base-200': isSelected }"
    data-testid="skill-row"
    :data-skill-id="skill.id"
  >
    <div class="list-col-grow flex-1 min-w-0">
      <button
        type="button"
        class="link no-underline rounded-box block w-full truncate py-1 text-left font-medium"
        data-testid="skill-row-open"
        @click="emit('open', skill, 'instructions')"
      >
        {{ displayName }}
      </button>
      <p
        class="truncate text-sm text-base-content/70"
        data-testid="skill-row-description"
      >
        {{ skill.description }}
      </p>
      <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-base-content/70">
        <span
          v-for="label in kindLabels"
          :key="label"
          class="badge badge-soft badge-sm"
          data-testid="skill-row-kind"
        >
          {{ label }}
        </span>
        <span
          v-if="statusBadge"
          class="badge badge-soft badge-sm"
          :class="statusBadge.class"
          data-testid="skill-row-status"
        >
          {{ statusBadge.label }}
        </span>
        <span
          v-if="skill.pendingVersion !== null"
          class="badge badge-soft badge-info badge-sm"
          data-testid="skill-row-pending"
        >
          Update to review
        </span>
        <span
          class="min-w-0 truncate"
          data-testid="skill-row-meta"
        >
          {{ metaLine }}
        </span>
        <span
          v-if="tokenEstimate !== null"
          data-testid="skill-row-tokens"
        >
          {{ tokenEstimate }}
        </span>
      </div>
      <p
        v-if="skill.status === 'broken'"
        class="mt-1 text-xs text-error"
        data-testid="skill-row-broken"
      >
        Files are missing. Restore an earlier version or delete it.
      </p>
    </div>

    <label
      class="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center sm:min-h-8 sm:min-w-8"
    >
      <span class="sr-only">
        {{ skill.enabled ? 'Turn off' : 'Turn on' }} {{ skill.name }}
      </span>
      <input
        type="checkbox"
        class="toggle toggle-sm"
        :checked="skill.enabled"
        :disabled="isBusy || skill.status === 'broken'"
        data-testid="skill-row-toggle"
        @click.prevent="emit('toggle', skill, !skill.enabled)"
      >
    </label>

    <details
      ref="dropdownRef"
      class="dropdown dropdown-end relative z-20 open:z-40"
      :class="isFlippedUp ? 'dropdown-top' : 'dropdown-bottom'"
      @toggle="updatePlacement"
    >
      <summary
        class="btn btn-ghost btn-sm btn-circle"
        :aria-label="`Actions for ${skill.name}`"
        data-testid="skill-row-actions-trigger"
      >
        <Icon name="lucide:ellipsis-vertical" size="16" />
      </summary>
      <div
        class="dropdown-content z-50 w-64"
        :class="isFlippedUp ? 'pb-2' : 'pt-2'"
        data-testid="skill-row-actions-menu"
      >
        <ul class="menu menu-sm bg-base-100 rounded-box shadow-lg w-64 p-1">
          <li v-if="skill.pendingVersion !== null">
            <button
              type="button"
              data-testid="skill-action-review-update"
              @click="onAction('review-update')"
            >
              <Icon name="lucide:git-pull-request-arrow" size="14" />
              Review update
            </button>
          </li>
          <li>
            <button
              type="button"
              data-testid="skill-action-versions"
              @click="onAction('versions')"
            >
              <Icon name="lucide:history" size="14" />
              Versions
            </button>
          </li>
          <li>
            <a
              :href="`/api/v1/skills/${skill.id}/download`"
              :download="`${skill.name}.zip`"
              data-testid="skill-action-download"
              @click="onDownload"
            >
              <Icon name="lucide:download" size="14" />
              Download .zip
            </a>
          </li>
          <li v-if="canCheckForUpdates">
            <button
              type="button"
              data-testid="skill-action-check-updates"
              @click="onAction('check-updates')"
            >
              <Icon name="lucide:refresh-cw" size="14" />
              Check for updates
            </button>
          </li>
          <li>
            <button
              type="button"
              class="text-error"
              data-testid="skill-action-delete"
              @click="onAction('delete')"
            >
              <Icon name="lucide:trash-2" size="14" />
              Delete
            </button>
          </li>
        </ul>
      </div>
    </details>
  </li>
</template>

<script setup lang="ts">
import type { SkillSummary } from '#shared/types/skills.d'
import type { SkillDetailTab } from '~/types/skills-ui.d'

const props = withDefaults(defineProps<{
  skill: SkillSummary
  isBusy?: boolean
  isSelected?: boolean
  canImportFromUrl?: boolean
}>(), {
  isBusy: false,
  isSelected: false,
  canImportFromUrl: false,
})

const emit = defineEmits<{
  open: [skill: SkillSummary, tab: SkillDetailTab]
  toggle: [skill: SkillSummary, enabled: boolean]
  reviewUpdate: [skill: SkillSummary]
  checkUpdates: [skill: SkillSummary]
  delete: [skill: SkillSummary]
}>()

const dropdownRef = useTemplateRef<HTMLDetailsElement>('dropdownRef')
const { isFlippedUp, updatePlacement } = useDropdownPlacement(dropdownRef)
const { onDownloadClick } = useFileDownload()
const isMounted = shallowRef<boolean>(false)

const displayName = computed<string>(() => {
  return getSkillDisplayName(props.skill)
})

const kindLabels = computed<string[]>(() => {
  return getSkillKindLabels(props.skill)
})

const canCheckForUpdates = computed<boolean>(() => {
  return props.skill.sourceKind === 'github' && props.canImportFromUrl
})

const statusBadge = computed<{ label: string, class: string } | null>(() => {
  if (props.skill.status === 'broken') {
    return { label: 'Broken', class: 'badge-error' }
  }

  if (props.skill.status === 'needs-review') {
    return { label: 'Needs review', class: 'badge-warning' }
  }

  if (!props.skill.enabled) {
    return { label: 'Off', class: '' }
  }

  return null
})

const metaLine = computed<string>(() => {
  const parts = [
    formatSkillSource(props.skill),
    `v${props.skill.currentVersion}`,
  ]

  if (isMounted.value) {
    parts.push(formatRelativeTime(props.skill.updatedAt))
  }

  return parts.filter(Boolean).join(' · ')
})

const tokenEstimate = computed<string | null>(() => {
  if (!props.skill.modelInvocable) {
    return null
  }

  const tokens = estimateSkillCatalogTokens(props.skill)

  return props.skill.enabled
    ? `≈ ${tokens} tokens in every message`
    : `≈ ${tokens} tokens in every message when on`
})

onClickOutside(dropdownRef, closeDropdown)

onMounted(() => {
  isMounted.value = true
})

function closeDropdown() {
  if (dropdownRef.value?.open) {
    dropdownRef.value.open = false
  }
}

function onAction(
  action: 'versions' | 'review-update' | 'check-updates' | 'delete',
) {
  closeDropdown()

  if (action === 'versions') {
    emit('open', props.skill, 'versions')
  } else if (action === 'review-update') {
    emit('reviewUpdate', props.skill)
  } else if (action === 'check-updates') {
    emit('checkUpdates', props.skill)
  } else {
    emit('delete', props.skill)
  }
}

async function onDownload(event: MouseEvent) {
  closeDropdown()
  await onDownloadClick(event, {
    url: `/api/v1/skills/${props.skill.id}/download`,
    fileName: `${props.skill.name}.zip`,
  })
}
</script>
