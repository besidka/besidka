<template>
  <UiSidePanelSkeleton
    v-if="status === 'pending' && !skill"
    :lines="4"
  />
  <div
    v-else-if="error && !skill"
    class="alert alert-error alert-soft my-4"
    role="alert"
    data-testid="skill-detail-error"
  >
    <Icon
      name="lucide:circle-alert"
      size="16"
      class="shrink-0"
      aria-hidden="true"
    />
    <span>{{ errorMessage }}</span>
    <button
      type="button"
      class="btn btn-sm"
      @click="refresh()"
    >
      Retry
    </button>
  </div>
  <div
    v-else-if="skill"
    class="flex flex-col gap-4 py-4"
    data-testid="skill-detail"
  >
    <div class="grid gap-2">
      <p
        class="text-sm"
        data-testid="skill-detail-description"
      >
        {{ skill.description }}
      </p>
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span
          v-for="label in getSkillKindLabels(skill)"
          :key="label"
          class="badge badge-soft badge-sm"
        >
          {{ label }}
        </span>
        <span class="badge badge-soft badge-sm">
          {{ getSkillLicenceLabel(skill.licence.class) }}
        </span>
        <span class="text-base-content/70">
          v{{ skill.currentVersion }} · {{ formatSkillSource(skill) }}
        </span>
      </div>
    </div>

    <div
      v-if="skill.status === 'broken'"
      class="alert alert-error alert-soft"
      role="alert"
      data-testid="skill-detail-broken"
    >
      <Icon
        name="lucide:circle-alert"
        size="16"
        class="shrink-0"
        aria-hidden="true"
      />
      <span>Files are missing. Restore an earlier version or delete it.</span>
    </div>

    <div
      v-if="skill.pendingVersion !== null"
      class="alert alert-info alert-soft"
      role="status"
      data-testid="skill-detail-pending"
    >
      <Icon
        name="lucide:git-pull-request-arrow"
        size="16"
        class="shrink-0"
        aria-hidden="true"
      />
      <span>An update is waiting for your review.</span>
      <button
        type="button"
        class="btn btn-sm"
        data-testid="skill-detail-review-update"
        @click="props.onReviewUpdate?.(skill.id)"
      >
        Review update
      </button>
    </div>

    <div
      class="tabs tabs-box tabs-sm w-full"
      role="tablist"
      aria-label="Skill details"
    >
      <button
        v-for="tab in TABS"
        :id="`skill-tab-${tab.id}`"
        :key="tab.id"
        type="button"
        role="tab"
        class="tab grow min-h-11 sm:min-h-8"
        :class="{ 'tab-active': activeTab === tab.id }"
        :aria-selected="activeTab === tab.id"
        :aria-controls="`skill-panel-${tab.id}`"
        :tabindex="activeTab === tab.id ? 0 : -1"
        :data-testid="`skill-tab-${tab.id}`"
        @click="activeTab = tab.id"
        @keydown="onTabKeydown"
      >
        {{ tab.label }}
      </button>
    </div>

    <div
      :id="`skill-panel-${activeTab}`"
      role="tabpanel"
      :aria-labelledby="`skill-tab-${activeTab}`"
      tabindex="0"
      class="min-w-0"
    >
      <ProfileSkillsFileText
        v-if="activeTab === 'instructions'"
        :skill-id="skill.id"
        :path="SKILL_MD_FILE_NAME"
        :version="skill.currentVersion"
      />
      <div
        v-else-if="activeTab === 'files'"
        class="grid gap-3"
      >
        <ProfileSkillsFileTree
          v-model="selectedPath"
          :files="skill.files"
        />
        <ProfileSkillsFileText
          :skill-id="skill.id"
          :path="selectedPath"
          :version="skill.currentVersion"
        />
      </div>
      <ProfileSkillsVersions
        v-else-if="activeTab === 'versions'"
        :skill-id="skill.id"
        :skill-name="skill.name"
        @review-update="props.onReviewUpdate?.(skill.id)"
      />
      <ProfileSkillsSettings
        v-else
        :skill="skill"
        @check-updates="onCheckUpdates"
        @delete="onDelete"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'
import type { SkillDetailTab } from '~/types/skills-ui.d'

const TABS: Array<{ id: SkillDetailTab, label: string }> = [
  { id: 'instructions', label: 'Instructions' },
  { id: 'files', label: 'Files' },
  { id: 'versions', label: 'Versions' },
  { id: 'settings', label: 'Settings' },
]

const props = defineProps<{
  skillId: string
  onDeleted?: (skillId: string) => unknown
  onReviewUpdate?: (skillId: string) => unknown
}>()

const { data: skill, status, error, refresh } = useSkillDetail(
  () => props.skillId,
)
const actions = useSkillActions()
const updateReview = useSkillUpdateReview()
const activeTab = useState<SkillDetailTab>(
  'skills:detail-tab',
  () => 'instructions',
)
const selectedPath = shallowRef<string>(SKILL_MD_FILE_NAME)

const errorMessage = computed<string>(() => {
  return error.value
    ? parseError(error.value).message || 'The skill could not be loaded.'
    : ''
})

watch(skill, (value) => {
  if (value && !value.files.some(file => file.path === selectedPath.value)) {
    selectedPath.value = SKILL_MD_FILE_NAME
  }
})

async function onTabKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
    return
  }

  const currentIndex = TABS.findIndex(tab => tab.id === activeTab.value)
  const step = event.key === 'ArrowRight' ? 1 : -1
  const next = TABS[(currentIndex + step + TABS.length) % TABS.length]!

  activeTab.value = next.id
  event.preventDefault()

  await nextTick()
  document.getElementById(`skill-tab-${next.id}`)?.focus()
}

async function onCheckUpdates() {
  if (!skill.value) {
    return
  }

  const result = await actions.checkForUpdates(skill.value)

  if (result === 'update') {
    updateReview.open(skill.value.id)
  }
}

async function onDelete() {
  if (!skill.value) {
    return
  }

  const isDeleted = await actions.deleteSkill(skill.value)

  if (isDeleted) {
    await props.onDeleted?.(skill.value.id)
  }
}
</script>
