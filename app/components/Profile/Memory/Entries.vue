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
          :project-id="projectId"
          :total="data?.total ?? null"
          :limit="entryLimit"
          @scope-change="changeScope"
          @changed="refresh()"
          @add="openCreate"
        />
        <details
          v-if="hasLegacyAboutMe"
          class="collapse collapse-arrow rounded-box border border-base-content/10"
          data-testid="memory-legacy-about-me"
        >
          <summary class="collapse-title text-sm font-semibold">
            Earlier about me (not converted)
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
            <p class="text-xs text-base-content/60">
              This text is still sent with every chat until you remove it.
            </p>
            <div class="flex justify-end">
              <UiButton
                mode="error"
                outline
                size="sm"
                normal-case
                text="Remove"
                :disabled="isRemovingAboutMe"
                data-testid="memory-legacy-about-me-remove"
                @click="removeLegacyAboutMe"
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
            <UiButton
              v-if="projectId"
              ghost
              size="sm"
              normal-case
              text="Back to account memory"
              data-testid="memory-entries-back-to-account"
              @click="changeScope(null)"
            />
          </div>
        </div>
        <ProfileMemoryEntriesEmpty
          v-else-if="orderedGroups.length === 0"
          :settings="settings"
          :project-id="projectId"
        />
        <div
          v-else
          class="grid gap-6"
          data-testid="memory-entries-list"
        >
          <ProfileMemoryEntriesEssentials
            :heading="essentialsHeading"
            :entries="essentialEntries"
            :can-add="!projectId"
            @select="openEntry"
            @add="openCreate"
          />
          <ProfileMemoryEntriesGroup
            v-for="group in otherGroups"
            :key="group.category"
            :category="group.category"
            :entries="group.entries"
            @select="openEntry"
          />
        </div>
      </div>
    </ProfileSecuritySectionCard>
    <LazyProfileMemoryEntriesDetailModal
      v-if="data"
      v-model:open="isDetailOpen"
      :entry="selectedEntry"
      :limits="data.limits"
      :project-id="projectId"
      :taken-singleton-categories="takenSingletonCategories"
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
import type { MemoryEntryModalChange } from '~/types/memory-entries.d'

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
    + 'Shorten it into an entry yourself, then remove this.',
  'profile-exists': 'You already have a Profile entry, so this was not '
    + 'merged. Copy what you need into it, then remove this.',
  'memory-off': 'Turn on Use memory and it will be converted automatically.',
  'rejected': 'It contains details Besidka does not save to memory, so it '
    + 'was not converted.',
}

const GENERIC_LEGACY_ABOUT_ME_REASON = 'It is still sent with every chat.'

const route = useRoute()
const router = useRouter()

const entriesHeading = useTemplateRef<HTMLElement>('entriesHeading')
const shouldRestoreFocus = shallowRef<boolean>(false)
const selectedEntry = shallowRef<MemoryEntry | null>(null)
const isDetailOpen = shallowRef<boolean>(false)
const isRemovingAboutMe = shallowRef<boolean>(false)
const isAboutMeRemoved = shallowRef<boolean>(false)

const projectId = computed<string | null>(() => {
  const { scope, project } = route.query

  if (scope !== 'project' || typeof project !== 'string' || !project) {
    return null
  }

  return project
})

const entriesKey = computed<string>(() => {
  return `memory-entries:${projectId.value ?? 'account'}`
})

const entriesQuery = computed(() => {
  if (projectId.value) {
    return { scope: 'project', projectId: projectId.value }
  }

  return { scope: 'account' }
})

const { data, pending, error, refresh } = await useLazyFetch(
  '/api/v1/memory/entries',
  {
    key: entriesKey,
    query: entriesQuery,
  },
)

const isInitialLoading = computed<boolean>(() => {
  return pending.value && !data.value
})

const parsedError = computed(() => {
  return error.value ? parseError(error.value) : null
})

const entryLimit = computed<number | null>(() => {
  if (!data.value) {
    return null
  }

  return projectId.value
    ? data.value.limits.maxProjectEntries
    : data.value.limits.maxAccountEntries
})

const orderedGroups = computed<MemoryEntryGroup[]>(() => {
  const groups = data.value?.groups ?? []

  return memoryCategoryOrder.flatMap((category) => {
    return groups.filter((group) => {
      return group.category === category && group.entries.length > 0
    })
  })
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

const takenSingletonCategories = computed<MemoryCategory[]>(() => {
  return orderedGroups.value
    .map(group => group.category)
    .filter(category => isEssentialCategory(category))
})

const essentialsHeading = computed<string>(() => {
  return projectId.value ? 'Essentials' : 'You'
})

const hasLegacyAboutMe = computed<boolean>(() => {
  if (projectId.value || isAboutMeRemoved.value) {
    return false
  }

  return !!props.settings.aboutMe?.trim()
})

const legacyAboutMeReason = computed<string>(() => {
  if (!props.aboutMeNotMigratedReason) {
    return GENERIC_LEGACY_ABOUT_ME_REASON
  }

  return legacyAboutMeReasons[props.aboutMeNotMigratedReason]
    ?? GENERIC_LEGACY_ABOUT_ME_REASON
})

async function changeScope(nextProjectId: string | null) {
  const query = { ...route.query }

  delete query.scope
  delete query.project

  if (nextProjectId) {
    query.scope = 'project'
    query.project = nextProjectId
  }

  await router.replace({ query })
}

async function focusHeadingWhenSettled() {
  if (!shouldRestoreFocus.value || isDetailOpen.value || pending.value) {
    return
  }

  await nextTick()

  shouldRestoreFocus.value = false
  entriesHeading.value?.focus()
}

async function onEntryChanged(change: MemoryEntryModalChange) {
  if (change.reason === 'deleted' || change.categoryChanged) {
    shouldRestoreFocus.value = true
  }

  await refresh()
  await focusHeadingWhenSettled()
}

watch(isDetailOpen, async (isOpen) => {
  if (isOpen) {
    return
  }

  await focusHeadingWhenSettled()
}, { flush: 'post' })

function openEntry(entry: MemoryEntry) {
  selectedEntry.value = entry
  isDetailOpen.value = true
}

function openCreate() {
  selectedEntry.value = null
  isDetailOpen.value = true
}

async function removeLegacyAboutMe() {
  const confirmation = await useConfirm({
    text: 'Remove earlier about me?',
    subtitle: 'It will no longer be sent with your chats. '
      + 'This cannot be undone.',
    alert: true,
    actions: ['Remove'],
    labelDecline: 'Cancel',
  })

  if (!confirmation) {
    return
  }

  isRemovingAboutMe.value = true

  try {
    await $fetch('/api/v1/profiles/settings', {
      method: 'PATCH',
      body: { aboutMe: null },
    })

    isAboutMeRemoved.value = true
    useInfoMessage('Removed', 'Earlier about me removed.')
    emit('aboutMeRemoved')
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to remove earlier about me.',
      parsedException.why,
    )
  } finally {
    isRemovingAboutMe.value = false
  }
}
</script>
