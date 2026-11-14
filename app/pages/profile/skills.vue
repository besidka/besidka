<template>
  <div class="mb-8 text-center">
    <h1 class="text-4xl font-bold">Skills</h1>
    <h2 class="mt-2">
      Skills teach the model how to do a task your way. Commands are skills
      you run with /name.
    </h2>
  </div>
  <div
    v-if="skillsFeature.active"
    class="grid gap-4"
    data-testid="skills-page"
  >
    <div
      v-if="needsReviewSkills.length"
      class="alert alert-warning alert-soft"
      role="status"
      data-testid="skills-review-banner"
    >
      <Icon
        name="lucide:triangle-alert"
        size="18"
        class="shrink-0"
        aria-hidden="true"
      />
      <span>
        {{ needsReviewSkills.length }}
        {{ needsReviewSkills.length === 1 ? 'skill needs' : 'skills need' }}
        review
      </span>
      <button
        type="button"
        class="btn btn-sm"
        data-testid="skills-review-banner-action"
        @click="onReviewFirst"
      >
        Review
      </button>
    </div>

    <ProfileSkillsFilters
      v-model:search="search"
      :source-options="sourceOptions"
      :kind-options="kindOptions"
      :source="appliedSource"
      :kind="appliedKind"
      :is-search-visible="isSearchVisible"
      @select-source="setSource"
      @select-kind="setKind"
    >
      <ProfileSkillsNewMenu
        v-if="!isLibraryEmpty"
        :can-import-from-url="importFromUrl.active"
        @select="onNew"
      />
    </ProfileSkillsFilters>

    <ProfileSkillsList
      :skills="visibleSkills"
      :has-loaded="hasLoaded"
      :has-error="hasError"
      :error-message="errorMessage"
      :is-skeleton-visible="isSkeletonVisible"
      :is-filtered="isFiltered"
      :busy-ids="busyIds"
      :selected-id="selectedId"
      :can-import-from-url="importFromUrl.active"
      @open="openDetail"
      @edit="skill => editSession.open(skill.id)"
      @set-mode="onSetMode"
      @review-update="onReviewUpdate"
      @check-updates="onCheckUpdates"
      @delete="onDelete"
      @retry="refresh()"
      @clear="clearFilters"
      @new="onNew"
    />
  </div>

  <LazyProfileSkillsCreateDialog
    v-if="createKind"
    :kind="createKind"
    @created="onCreated"
    @close="createKind = null"
  />
  <LazyProfileSkillsEditDialog
    v-if="editSkillId"
    :skill-id="editSkillId"
    :is-just-created="isEditJustCreated"
    @saved="onEdited"
    @close="editSession.close()"
  />
  <LazyProfileSkillsImportDialog
    v-if="importTab"
    :initial-tab="importTab"
    :can-import-from-url="importFromUrl.active"
    @installed="onInstalled"
    @close="importTab = null"
  />
  <LazyProfileSkillsUpdateReview
    v-if="reviewSkillId"
    :skill-id="reviewSkillId"
    @close="updateReview.close()"
  />
</template>

<script setup lang="ts">
import {
  LazyProfileSkillsDetailHeader,
  LazyProfileSkillsDetailPanel,
} from '#components'
import type { SkillSummary } from '#shared/types/skills.d'
import type { SkillMode } from '#shared/utils/skills/mode'
import type {
  SkillCreateKind,
  SkillDetailTab,
  SkillImportTab,
  SkillNewAction,
} from '~/types/skills-ui.d'

definePageMeta({
  layout: 'profile',
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Skills',
})

const skillsFeature = useFeature('skills')
const importFromUrl = useFeature('skills.import-url')

if (!skillsFeature.value.active) {
  await navigateTo('/profile/security', { replace: true })
}

const sidePanel = useSidePanel()
const detailTab = useState<SkillDetailTab>(
  'skills:detail-tab',
  () => 'instructions',
)
const {
  search,
  appliedSource,
  appliedKind,
  appliedQuery,
  setSource,
  setKind,
  clearFilters,
} = useSkillsFilters()
const {
  skills,
  visibleSkills,
  needsReviewSkills,
  sourceOptions,
  kindOptions,
  isSearchVisible,
  hasLoaded,
  hasError,
  errorMessage,
  isSkeletonVisible,
  refresh,
} = useSkillsLibrary({
  source: appliedSource,
  kind: appliedKind,
  query: appliedQuery,
})
const actions = useSkillActions()
const updateReview = useSkillUpdateReview()
const editSession = useSkillEditSession()
const busyIds = actions.busyIds

const createKind = shallowRef<SkillCreateKind | null>(null)
const importTab = shallowRef<SkillImportTab | null>(null)
const reviewSkillId = updateReview.skillId
const editSkillId = editSession.skillId
const isEditJustCreated = editSession.isJustCreated

const isLibraryEmpty = computed<boolean>(() => {
  return hasLoaded.value && !skills.value.length
})

const isFiltered = computed<boolean>(() => {
  return !!appliedQuery.value
    || appliedSource.value !== 'all'
    || appliedKind.value !== 'all'
})

const selectedId = computed<string | null>(() => {
  const viewKey = sidePanel.viewKey.value

  return viewKey?.startsWith(SKILL_VIEW_KEY_PREFIX)
    ? viewKey.slice(SKILL_VIEW_KEY_PREFIX.length)
    : null
})

watch(sourceOptions, async (options) => {
  if (
    options.length
    && !options.some(option => option.value === appliedSource.value)
  ) {
    await setSource('all', { replace: true })
  }
}, { immediate: true })

watch(kindOptions, async (options) => {
  if (
    options.length
    && !options.some(option => option.value === appliedKind.value)
  ) {
    await setKind('all', { replace: true })
  }
}, { immediate: true })

function openDetail(
  skill: Pick<SkillSummary, 'id' | 'name'>,
  tab: SkillDetailTab = 'instructions',
) {
  detailTab.value = tab
  sidePanel.open({
    viewKey: `${SKILL_VIEW_KEY_PREFIX}${skill.id}`,
    title: skill.name,
    mode: 'detail',
    component: LazyProfileSkillsDetailPanel,
    headerActions: LazyProfileSkillsDetailHeader,
    props: {
      skillId: skill.id,
      onDeleted: closeDetailFor,
      onReviewUpdate: (skillId: string) => {
        updateReview.open(skillId)
      },
    },
  })
}

function closeDetailFor(skillId: string) {
  if (selectedId.value === skillId) {
    sidePanel.close()
  }
}

function onNew(action: SkillNewAction) {
  if (action === 'blank' || action === 'command' || action === 'template') {
    createKind.value = action

    return
  }

  importTab.value = action
}

async function onSetMode(skill: SkillSummary, mode: SkillMode) {
  await actions.setMode(skill, mode)
}

function onReviewUpdate(skill: SkillSummary) {
  updateReview.open(skill.id)
}

async function onCheckUpdates(skill: SkillSummary) {
  const result = await actions.checkForUpdates(skill)

  if (result === 'update') {
    updateReview.open(skill.id)
  }
}

async function onDelete(skill: SkillSummary) {
  const isDeleted = await actions.deleteSkill(skill)

  if (isDeleted) {
    closeDetailFor(skill.id)
  }
}

function onReviewFirst() {
  const first = needsReviewSkills.value[0]

  if (!first) {
    return
  }

  if (first.pendingVersion !== null) {
    updateReview.open(first.id)

    return
  }

  openDetail(first)
}

function onEdited(saved: { id: string, isRenamed: boolean }) {
  if (!saved.isRenamed || selectedId.value !== saved.id) {
    return
  }

  const renamed = skills.value.find((skill) => {
    return skill.id === saved.id
  })

  if (renamed) {
    openDetail(renamed, detailTab.value)
  }
}

async function onCreated(created: { id: string, name: string }) {
  await refreshSkillData()
  editSession.open(created.id, { isJustCreated: true })
}

async function onInstalled(installed: {
  kind: 'created' | 'pending'
  id: string
  name: string
}) {
  await refreshSkillData(installed.id)

  if (installed.kind === 'pending') {
    updateReview.open(installed.id)

    return
  }

  openDetail(installed)
}

onBeforeUnmount(() => {
  editSession.close()

  if (selectedId.value) {
    sidePanel.close()
  }
})
</script>
