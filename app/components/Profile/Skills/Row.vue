<template>
  <li
    class="
      list-row items-center gap-3 group py-3 sm:py-2 relative
      max-sm:grid-flow-row max-sm:grid-cols-[minmax(0,1fr)_auto]
      [&:has(details[open])]:z-30
    "
    :class="{ 'bg-base-200': isSelected }"
    data-testid="skill-row"
    :data-skill-id="skill.id"
  >
    <div class="list-col-grow flex-1 min-w-0 max-sm:col-start-1 max-sm:row-start-1">
      <button
        type="button"
        class="link no-underline rounded-box block w-full truncate py-1 text-left font-medium"
        data-testid="skill-row-open"
        @click="emit('open', skill, 'instructions')"
      >
        {{ skill.name }}
      </button>
      <p
        class="truncate text-sm text-base-content/70"
        data-testid="skill-row-description"
      >
        {{ skill.description }}
      </p>
      <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-base-content/70">
        <span
          v-if="skill.command && commandsFeature.active"
          class="badge badge-soft badge-sm"
          data-testid="skill-row-command"
        >
          /{{ skill.command }}
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

    <ProfileSkillsModeControl
      :skill="skill"
      :is-disabled="isBusy"
      class="max-sm:col-start-1 max-sm:row-start-2 max-sm:justify-self-start"
      test-id="skill-row-mode"
      @select="mode => emit('setMode', skill, mode)"
    />

    <details
      ref="dropdownRef"
      class="dropdown dropdown-end relative z-20 open:z-40 max-sm:col-start-2 max-sm:row-start-1 max-sm:self-start"
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
          <li>
            <button
              type="button"
              data-testid="skill-action-edit"
              @click="onAction('edit')"
            >
              <Icon name="lucide:pencil" size="14" />
              Edit
            </button>
          </li>
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
import { getSkillMode } from '#shared/utils/skills/mode'
import type { SkillMode } from '#shared/utils/skills/mode'
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
  setMode: [skill: SkillSummary, mode: SkillMode]
  edit: [skill: SkillSummary]
  reviewUpdate: [skill: SkillSummary]
  checkUpdates: [skill: SkillSummary]
  delete: [skill: SkillSummary]
}>()

const dropdownRef = useTemplateRef<HTMLDetailsElement>('dropdownRef')
const { isFlippedUp, updatePlacement } = useDropdownPlacement(dropdownRef)
const { onDownloadClick } = useFileDownload()
const commandsFeature = useFeature('skills.commands')
const isMounted = shallowRef<boolean>(false)

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
  if (getSkillMode(props.skill) !== 'auto') {
    return null
  }

  return `≈ ${estimateSkillCatalogTokens(props.skill)} tokens in every message`
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
  action: 'edit' | 'versions' | 'review-update' | 'check-updates' | 'delete',
) {
  closeDropdown()

  if (action === 'edit') {
    emit('edit', props.skill)
  } else if (action === 'versions') {
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
