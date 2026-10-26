<template>
  <div data-testid="memory-entries-section">
    <ProfileSecuritySectionCard
      heading="What Besidka remembers"
      :description="description"
    >
      <div class="grid gap-4">
        <h3
          ref="entriesHeading"
          tabindex="-1"
          class="js-memory-entries-heading sr-only focus:outline-none"
          data-testid="memory-entries-heading"
        >
          Memory entries
        </h3>
        <div
          v-if="!settings.memoryEnabled"
          role="status"
          class="alert alert-soft alert-warning"
          data-testid="memory-disabled-note"
        >
          <Icon
            name="lucide:circle-alert"
            size="20"
            class="shrink-0"
          />
          <span>Memory is off. Entries are kept but not used in chats.</span>
        </div>
        <ProfileMemoryEntriesToolbar
          :settings="settings"
          :total="accountTotal"
          :limit="accountLimit"
          @changed="refresh()"
          @add="openCreate(null)"
        >
          <template
            v-if="$slots['extra-actions']"
            #extra-actions
          >
            <slot name="extra-actions" />
          </template>
        </ProfileMemoryEntriesToolbar>
        <ProfileMemoryInstructBox
          v-if="settings.memoryEnabled"
          :model-id="settings.profileMemoryModel"
          @changed="refresh()"
        />
        <details
          v-if="hasLegacyAboutMe"
          open
          class="collapse collapse-arrow rounded-box border border-base-content/10"
          data-testid="memory-legacy-about-me"
        >
          <summary class="collapse-title text-sm font-semibold">
            Earlier about me (not used in chats)
          </summary>
          <div class="collapse-content grid gap-3">
            <p
              class="text-sm text-base-content/70"
              data-testid="memory-legacy-about-me-reason"
            >
              {{ legacyAboutMeReason }}
            </p>
            <div class="max-h-[min(300px,33dvh)] overflow-y-auto rounded-box bg-base-content/5 p-3">
              <p
                class="whitespace-pre-wrap break-words text-sm"
                data-testid="memory-legacy-about-me-text"
              >
                {{ settings.aboutMe }}
              </p>
            </div>
            <p
              class="text-xs text-base-content/60"
              data-testid="memory-legacy-about-me-note"
            >
              It isn't sent to chats until you keep it.
            </p>
            <div class="flex flex-wrap justify-end gap-2">
              <UiButton
                mode="error"
                outline
                size="sm"
                normal-case
                text="Discard old text"
                :disabled="isRemovingAboutMe"
                data-testid="memory-legacy-about-me-discard"
                @click="discardLegacyAboutMe"
              />
              <UiButton
                mode="neutral"
                ghost
                size="sm"
                normal-case
                text="Edit and keep"
                :disabled="isRemovingAboutMe"
                data-testid="memory-legacy-about-me-edit"
                @click="editLegacyAboutMe"
              />
              <UiButton
                size="sm"
                normal-case
                text="Keep as new entry"
                :disabled="isRemovingAboutMe"
                data-testid="memory-legacy-about-me-save"
                @click="keepLegacyAboutMe"
              />
            </div>
          </div>
        </details>
        <div
          v-if="isInitialLoading"
          class="grid gap-2"
          aria-busy="true"
          data-testid="memory-entries-skeleton"
        >
          <div
            v-for="rowIndex in 3"
            :key="rowIndex"
            class="skeleton skeleton--default h-20 w-full"
          />
        </div>
        <div
          v-else-if="parsedError"
          role="alert"
          class="alert alert-soft alert-error !items-start"
          data-testid="memory-entries-error"
        >
          <Icon
            name="lucide:circle-alert"
            size="20"
            class="mt-0.5 shrink-0"
          />
          <div class="grid gap-1">
            <p class="font-bold">
              {{ parsedError.message || 'Failed to load memory.' }}
            </p>
            <p v-if="parsedError.why" class="text-sm">{{ parsedError.why }}</p>
            <p v-if="parsedError.fix" class="text-sm">{{ parsedError.fix }}</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <UiButton
              mode="error"
              outline
              size="sm"
              normal-case
              text="Try again"
              data-testid="memory-entries-retry"
              @click="refresh()"
            />
          </div>
        </div>
        <ProfileMemoryEntriesEmpty
          v-else-if="orderedGroups.length === 0 && projectSections.length === 0"
          :settings="settings"
        />
        <div
          v-else
          class="grid gap-6"
          data-testid="memory-entries-list"
        >
          <ProfileMemoryEntriesEssentials
            heading="You"
            :entries="essentialEntries"
            can-add
            @select="openEntry"
            @add="openCreate(null)"
          />
          <ProfileMemoryEntriesGroup
            v-for="group in otherGroups"
            :key="group.category"
            :category="group.category"
            :entries="group.entries"
            @select="openEntry"
          />
          <div
            v-if="projectSections.length > 0"
            class="grid gap-2"
          >
            <div
              v-if="projectsError"
              class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-base-content/70"
              role="status"
              data-testid="memory-projects-names-error"
            >
              <span>Couldn't load project names.</span>
              <UiButton
                ghost
                size="sm"
                normal-case
                text="Try again"
                data-testid="memory-projects-names-retry"
                @click="refreshProjects()"
              />
            </div>
            <ProfileMemoryEntriesProjects
              :projects="projectSections"
              :limit="projectEntryLimit"
              :focus-project-id="focusProjectId"
              @select="openEntry"
              @add="openCreate"
              @changed="refresh()"
              @focused="focusProjectId = null"
            />
          </div>
        </div>
      </div>
    </ProfileSecuritySectionCard>
    <LazyProfileMemoryEntriesDetailModal
      v-if="data"
      v-model:open="isDetailOpen"
      :entry="selectedEntry"
      :limits="data.limits"
      :project-id="modalProjectId"
      :taken-singleton-categories="takenSingletonCategories"
      :initial-values="legacyEntryValues"
      @changed="onEntryChanged"
    />
  </div>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import { alwaysInjectedMemoryCategories } from '#shared/utils/memory-policy'
import type {
  AboutMeNotMigratedReason,
  MemoryCategory,
  MemoryEntry,
  MemorySettingsFields,
} from '#shared/types/memory.d'
import type { MemoryEntryGroup } from '#shared/types/memory-api.d'
import type {
  MemoryEntryInitialValues,
  MemoryEntryModalChange,
  MemoryProjectSection,
} from '~/types/memory-entries.d'

const props = withDefaults(defineProps<{
  settings: MemorySettingsFields
  aboutMeNotMigratedReason?: AboutMeNotMigratedReason | null
}>(), {
  aboutMeNotMigratedReason: null,
})

const emit = defineEmits<{
  aboutMeRemoved: []
}>()

const description = 'Everything Besidka keeps about you, grouped by '
  + 'category. Add, edit or delete anything.'

const legacyAboutMeReasons: Record<AboutMeNotMigratedReason, string> = {
  'too-long': 'It is too long to become a Profile entry (limit 1 KB). '
    + 'Shorten it when saving, or discard it.',
  'profile-exists': 'This is your old About me text. It wasn\'t added '
    + 'automatically because you already have a Profile entry. If it already '
    + 'covers this, discard it. Otherwise keep it as a new entry, or open it '
    + 'to edit first.',
  'memory-off': 'Turn on Use memory and it will be converted automatically.',
  'entries-full': 'Your account memory is full (30 entries). Delete one and '
    + 'this converts automatically.',
  'rejected': 'It contains details Besidka does not save to memory, so it '
    + 'was not converted. Open it to edit those details out, or discard it.',
}

const GENERIC_LEGACY_ABOUT_ME_REASON = 'This is your old About me text. It '
  + 'wasn\'t added to memory automatically.'

const UNKNOWN_PROJECT_NAME = 'Unknown project'

const route = useRoute()

const entriesHeading = useTemplateRef<HTMLElement>('entriesHeading')
const shouldRestoreFocus = shallowRef<boolean>(false)
const selectedEntry = shallowRef<MemoryEntry | null>(null)
const modalProjectId = shallowRef<string | null>(null)
const isDetailOpen = shallowRef<boolean>(false)
const isRemovingAboutMe = shallowRef<boolean>(false)
const legacyEntryValues = shallowRef<MemoryEntryInitialValues | null>(null)
const isLegacySavePending = shallowRef<boolean>(false)
const targetProjectId = computed<string | null>(() => {
  return readProjectQuery(route.query.project)
})
const focusProjectId = shallowRef<string | null>(targetProjectId.value)

const {
  projects,
  isLoading: isProjectsLoading,
  error: projectsError,
  refresh: refreshProjects,
} = useMemoryProjects()

const { data, pending, error, refresh } = await useLazyFetch(
  '/api/v1/memory/entries',
  {
    key: 'memory-entries:all',
    query: { scope: 'all' },
  },
)

const isInitialLoading = computed<boolean>(() => {
  return (pending.value && !data.value) || isProjectsLoading.value
})

const parsedError = computed(() => {
  return error.value ? parseError(error.value) : null
})

const accountLimit = computed<number | null>(() => {
  return data.value?.limits.maxAccountEntries ?? null
})

const projectEntryLimit = computed<number>(() => {
  return data.value?.limits.maxProjectEntries ?? 0
})

const allEntries = computed<MemoryEntry[]>(() => {
  return (data.value?.groups ?? []).flatMap(group => group.entries)
})

const accountEntries = computed<MemoryEntry[]>(() => {
  return allEntries.value.filter(entry => !entry.projectId)
})

const accountTotal = computed<number | null>(() => {
  return data.value ? accountEntries.value.length : null
})

const orderedGroups = computed<MemoryEntryGroup[]>(() => {
  return memoryListCategoryOrder
    .map((category) => {
      return {
        category,
        entries: accountEntries.value.filter((entry) => {
          return entry.category === category
        }),
      }
    })
    .filter(group => group.entries.length > 0)
})

function isEssentialCategory(category: MemoryCategory): boolean {
  return (alwaysInjectedMemoryCategories as readonly string[])
    .includes(category)
}

const essentialEntries = computed<MemoryEntry[]>(() => {
  return orderedGroups.value
    .filter(group => isEssentialCategory(group.category))
    .flatMap(group => group.entries)
})

const otherGroups = computed<MemoryEntryGroup[]>(() => {
  return orderedGroups.value.filter((group) => {
    return !isEssentialCategory(group.category)
  })
})

const entriesByProjectId = computed<Map<string, MemoryEntry[]>>(() => {
  const entriesByProject = new Map<string, MemoryEntry[]>()

  for (const category of memoryListCategoryOrder) {
    for (const entry of allEntries.value) {
      if (!entry.projectId || entry.category !== category) {
        continue
      }

      const projectEntries = entriesByProject.get(entry.projectId) ?? []

      projectEntries.push(entry)
      entriesByProject.set(entry.projectId, projectEntries)
    }
  }

  return entriesByProject
})

const projectSections = computed<MemoryProjectSection[]>(() => {
  const knownProjectIds = new Set(projects.value.map(project => project.id))
  const knownSections = projects.value.flatMap((project) => {
    const entries = entriesByProjectId.value.get(project.id)

    if (!entries && project.id !== targetProjectId.value) {
      return []
    }

    return [{
      id: project.id,
      name: project.name,
      isMemoryOff: project.memoryStatus === 'disabled',
      isArchived: project.isArchived,
      entries: entries ?? [],
    }]
  })
  const unknownSections = [...entriesByProjectId.value]
    .filter(([projectId]) => !knownProjectIds.has(projectId))
    .map(([projectId, entries]) => {
      return {
        id: projectId,
        name: UNKNOWN_PROJECT_NAME,
        isMemoryOff: false,
        isArchived: false,
        entries,
      }
    })

  return [...knownSections, ...unknownSections]
})

const takenSingletonCategories = computed<MemoryCategory[]>(() => {
  return allEntries.value
    .filter((entry) => {
      return (entry.projectId ?? null) === modalProjectId.value
    })
    .map(entry => entry.category)
    .filter(category => isEssentialCategory(category))
})

const hasAccountProfileEntry = computed<boolean>(() => {
  return accountEntries.value.some((entry) => {
    return entry.category === 'profile'
  })
})

const hasLegacyAboutMe = computed<boolean>(() => {
  return !!props.settings.aboutMe?.trim()
})

const legacyAboutMeReason = computed<string>(() => {
  if (!props.aboutMeNotMigratedReason) {
    return GENERIC_LEGACY_ABOUT_ME_REASON
  }

  return legacyAboutMeReasons[props.aboutMeNotMigratedReason]
    ?? GENERIC_LEGACY_ABOUT_ME_REASON
})

function readProjectQuery(project: unknown): string | null {
  if (typeof project !== 'string' || !project) {
    return null
  }

  return project
}

watch(targetProjectId, (projectId) => {
  focusProjectId.value = projectId
})

async function focusHeadingWhenSettled() {
  if (!shouldRestoreFocus.value || isDetailOpen.value || pending.value) {
    return
  }

  await nextTick()

  shouldRestoreFocus.value = false
  entriesHeading.value?.focus()
}

async function onEntryChanged(change: MemoryEntryModalChange) {
  const isLegacySave = isLegacySavePending.value
    && change.reason === 'created'

  if (change.reason === 'deleted' || change.categoryChanged) {
    shouldRestoreFocus.value = true
  }

  if (isLegacySave) {
    isLegacySavePending.value = false
    await clearSavedLegacyAboutMe()
  }

  await refresh()
  await focusHeadingWhenSettled()
}

watch(isDetailOpen, async (isOpen) => {
  if (isOpen) {
    return
  }

  isLegacySavePending.value = false
  legacyEntryValues.value = null

  await focusHeadingWhenSettled()
}, { flush: 'post' })

function openEntry(entry: MemoryEntry) {
  legacyEntryValues.value = null
  isLegacySavePending.value = false
  selectedEntry.value = entry
  modalProjectId.value = entry.projectId ?? null
  isDetailOpen.value = true
}

function openCreate(projectId: string | null) {
  legacyEntryValues.value = null
  isLegacySavePending.value = false
  selectedEntry.value = null
  modalProjectId.value = projectId
  isDetailOpen.value = true
}

function editLegacyAboutMe() {
  const aboutMe = props.settings.aboutMe

  if (!aboutMe?.trim()) {
    return
  }

  legacyEntryValues.value = buildLegacyAboutMeEntryValues(
    aboutMe,
    hasAccountProfileEntry.value,
  )
  isLegacySavePending.value = true
  selectedEntry.value = null
  modalProjectId.value = null
  isDetailOpen.value = true
}

async function keepLegacyAboutMe() {
  const aboutMe = props.settings.aboutMe

  if (!aboutMe?.trim() || isRemovingAboutMe.value) {
    return
  }

  isRemovingAboutMe.value = true

  try {
    await $fetch('/api/v1/memory/entries', {
      method: 'POST',
      body: buildLegacyAboutMeEntryValues(
        aboutMe,
        hasAccountProfileEntry.value,
      ),
    })
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to keep the earlier about me.',
      [parsedException.why, 'Use Edit and keep to change it first.']
        .filter(Boolean)
        .join(' '),
    )
    isRemovingAboutMe.value = false

    return
  }

  isRemovingAboutMe.value = false

  await clearSavedLegacyAboutMe()
  await refresh()
}

async function clearAboutMe() {
  await $fetch('/api/v1/profiles/settings', {
    method: 'PATCH',
    body: { aboutMe: null },
  })

  emit('aboutMeRemoved')
}

async function clearSavedLegacyAboutMe() {
  isRemovingAboutMe.value = true

  try {
    await clearAboutMe()

    useInfoMessage('Saved', 'About me saved as a memory entry.')
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      'Saved, but the earlier text could not be removed.',
      [parsedException.why, 'Remove it manually.']
        .filter(Boolean)
        .join(' '),
    )
  } finally {
    isRemovingAboutMe.value = false
  }
}

async function discardLegacyAboutMe() {
  const confirmation = await useConfirm({
    text: 'Discard earlier about me?',
    subtitle: 'The text will be deleted. This cannot be undone.',
    alert: true,
    actions: ['Discard'],
    labelDecline: 'Cancel',
  })

  if (!confirmation) {
    return
  }

  isRemovingAboutMe.value = true

  try {
    await clearAboutMe()

    useInfoMessage('Discarded', 'Earlier about me discarded.')
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to discard earlier about me.',
      parsedException.why,
    )
  } finally {
    isRemovingAboutMe.value = false
  }
}
</script>
