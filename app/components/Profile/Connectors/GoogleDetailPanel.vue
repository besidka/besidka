<template>
  <div
    class="flex flex-col gap-5 py-4"
    data-testid="google-detail-panel"
  >
    <p
      class="sr-only"
      aria-live="polite"
      data-testid="google-detail-live"
    >
      {{ announcement }}
    </p>

    <UiSidePanelSkeleton
      v-if="!entry && status === 'pending'"
      :lines="3"
    />
    <div
      v-else-if="!entry && status === 'error'"
      class="alert alert-error alert-soft"
      role="alert"
      data-testid="google-detail-error"
    >
      <Icon
        name="lucide:circle-alert"
        size="16"
        class="shrink-0"
        aria-hidden="true"
      />
      <span>The Google connection could not be loaded.</span>
      <button
        type="button"
        class="btn btn-sm"
        data-testid="google-detail-retry"
        @click="refresh()"
      >
        Try again
      </button>
    </div>
    <div
      v-else-if="!entry"
      class="alert alert-info alert-soft"
      role="status"
      data-testid="google-detail-missing"
    >
      <span>This Google service is not available for your account.</span>
    </div>

    <template v-else>
      <div class="flex items-start gap-3">
        <div
          class="avatar shrink-0"
          aria-hidden="true"
        >
          <div class="grid w-10 place-items-center rounded-full bg-base-200">
            <Icon
              :name="entry.icon"
              size="24"
            />
          </div>
        </div>
        <div class="grid min-w-0 gap-1">
          <p class="flex flex-wrap items-center gap-2">
            <span
              class="break-words text-lg font-semibold"
              data-testid="google-detail-title"
            >
              {{ entry.title }}
            </span>
            <span
              class="badge badge-soft badge-sm"
              data-testid="google-detail-badge"
            >
              Built in
            </span>
          </p>
          <p
            class="break-all text-sm font-medium"
            data-testid="google-detail-state"
          >
            {{ entry.stateLine }}
          </p>
        </div>
      </div>

      <p
        class="break-words text-sm"
        data-testid="google-detail-description"
      >
        {{ entry.description }}
      </p>

      <div class="flex flex-wrap gap-2">
        <NuxtLink
          v-if="entry.action === 'link' && entry.linkPath"
          :to="entry.linkPath"
          class="btn btn-sm min-h-11 sm:min-h-8"
          data-testid="google-detail-action"
        >
          {{ entry.actionLabel }}
        </NuxtLink>
        <button
          v-else-if="entry.action && entry.action !== 'disconnect'"
          type="button"
          class="btn btn-primary btn-sm min-h-11 sm:min-h-8"
          :disabled="isBusy"
          data-testid="google-detail-action"
          @click="actions.run(entry)"
        >
          {{ entry.actionLabel }}
        </button>
        <button
          v-if="entry.canDisconnect"
          type="button"
          class="btn btn-error btn-outline btn-sm min-h-11 sm:min-h-8"
          :disabled="isBusy"
          data-testid="google-detail-disconnect"
          @click="disconnect"
        >
          <Icon
            name="lucide:unplug"
            size="16"
            aria-hidden="true"
          />
          Disconnect
        </button>
      </div>

      <div>
        <button
          type="button"
          class="btn btn-ghost btn-sm min-h-11 gap-2 px-2 sm:min-h-8"
          :aria-expanded="isInfoOpen"
          aria-controls="google-detail-info"
          data-testid="google-detail-info-toggle"
          @click="isInfoOpen = !isInfoOpen"
        >
          <Icon
            name="lucide:info"
            size="16"
            aria-hidden="true"
          />
          What Besidka can reach
        </button>
        <p
          v-if="isInfoOpen"
          id="google-detail-info"
          class="mt-2 break-words rounded-box bg-base-200 px-3 py-2 text-xs"
          data-testid="google-detail-info"
        >
          {{ infoText }}
        </p>
      </div>

      <section
        v-if="isToolsSectionShown"
        class="grid gap-3"
        aria-labelledby="google-detail-tools-heading"
        data-testid="google-detail-tools"
      >
        <h3
          id="google-detail-tools-heading"
          class="text-sm font-semibold"
        >
          Tools
        </h3>
        <p
          class="text-xs text-base-content/70"
          data-testid="google-detail-tools-intro"
        >
          {{ toolsIntro }}
        </p>
        <p
          class="text-xs text-base-content/70"
          data-testid="google-detail-tools-blocked-note"
        >
          A blocked tool is never offered to the model. Google tools have no
          Always allow.
        </p>
        <UiSidePanelSkeleton
          v-if="permissions.status.value === 'pending' && !hasPermissionData"
          :lines="3"
        />
        <div
          v-else-if="permissions.error.value && !hasPermissionData"
          class="alert alert-error alert-soft"
          role="alert"
          data-testid="google-detail-tools-error"
        >
          <Icon
            name="lucide:circle-alert"
            size="16"
            class="shrink-0"
            aria-hidden="true"
          />
          <span>The tool permissions did not load.</span>
          <button
            type="button"
            class="btn btn-sm"
            data-testid="google-detail-tools-retry"
            @click="permissions.refresh()"
          >
            Retry
          </button>
        </div>
        <UiToolPermissions
          v-else
          :groups="permissionGroups"
          @set-tools="onSetTools"
          @set-group="onSetGroup"
        />
        <p
          class="sr-only"
          aria-live="polite"
          data-testid="google-detail-permission-live"
        >
          {{ permissions.announcement.value }}
        </p>
      </section>

      <section
        v-if="ownClientNote"
        class="grid gap-2 rounded-box border border-base-content/10 p-3"
        data-testid="google-detail-own-client"
      >
        <p
          class="text-sm"
          data-testid="google-detail-own-client-hint"
        >
          {{ ownClientNote.text }}
        </p>
        <div>
          <NuxtLink
            v-if="ownClientNote.linkPath"
            :to="ownClientNote.linkPath"
            class="btn btn-sm min-h-11 sm:min-h-8"
            data-testid="google-detail-own-client-link"
          >
            Add client
          </NuxtLink>
          <button
            v-else
            type="button"
            class="btn btn-primary btn-sm min-h-11 sm:min-h-8"
            :disabled="isBusy"
            data-testid="google-detail-own-client-add-access"
            @click="actions.addDriveSearchAccess(entry)"
          >
            Add access
          </button>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { GOOGLE_CALENDAR_ACCESS_NOTE } from '#shared/utils/google-calendar-tools'
import {
  GOOGLE_ENTRY_IDS,
  GOOGLE_KEYS_TAB_PATH,
} from '#shared/utils/google-connectors'
import type { GoogleEntryId } from '#shared/utils/google-connectors'
import { GOOGLE_TOOL_KINDS } from '#shared/utils/google-tool-approvals'
import {
  GOOGLE_TOOL_APPROVAL_LABELS,
  GOOGLE_TOOL_PERMISSION_MODES,
  getGoogleServiceTools,
  getGoogleToolAlwaysAllowHint,
  getGoogleToolApprovalLabel,
  isGoogleToolPermissionMode,
} from '#shared/utils/google-tool-catalog'
import type { GoogleToolCatalogEntry } from '#shared/utils/google-tool-catalog'
import type { ToolPermissionMode } from '#shared/utils/tool-approval-policy'
import type { GoogleEntry } from '~/utils/google-entries'
import type {
  ToolPermissionChange,
  ToolPermissionGroup,
} from '~/utils/tool-permissions'

interface ToolGroup {
  kind: 'read' | 'write'
  label: string
  tools: GoogleToolCatalogEntry[]
}

interface OwnClientNote {
  text: string
  linkPath: string | null
}

const INFO_TEXTS: Readonly<Record<GoogleEntryId, string>> = {
  'google-drive': 'Besidka can open only the Google Drive files you pick, '
    + 'and copies them into your Besidka files. Without Change files access '
    + 'it never changes a Google file. Saving a Besidka file to Google Drive '
    + 'creates a new Drive file '
    + 'after you approve it. The copies are deleted when Google access '
    + 'ends.',
  'google-gmail': 'Besidka reads mail only when the model searches it or '
    + 'opens a thread and you approve. It can write drafts you approve. '
    + 'Google\'s permission for drafts technically also allows sending mail, '
    + 'but Besidka has no code that sends mail.',
  'google-calendar': GOOGLE_CALENDAR_ACCESS_NOTE,
}

const DRIVE_WRITE_INFO_TEXT = 'One exception: with your own Google client '
  + 'and Change files access, it can also create a folder in your own My '
  + 'Drive after you approve it. It cannot delete anything or change who can '
  + 'see a file.'

const props = defineProps<{
  entryId: GoogleEntryId
}>()

const { data, status, refresh, entries } = useGoogleEntries()
const actions = useGoogleEntryActions()
const { isBusy, announcement } = actions
const permissions = useGoogleToolPermissions()
const isInfoOpen = shallowRef<boolean>(false)

const entry = computed<GoogleEntry | null>(() => {
  return GOOGLE_ENTRY_IDS.includes(props.entryId)
    ? entries.value.find(candidate => candidate.id === props.entryId) ?? null
    : null
})

const infoText = computed<string>(() => {
  const base = INFO_TEXTS[props.entryId]

  return props.entryId === 'google-drive' && isDriveWriteGranted.value
    ? `${base} ${DRIVE_WRITE_INFO_TEXT}`
    : base
})

const isOwnClientOwner = computed<boolean>(() => {
  return data.value?.byo?.canManage === true
})

const toolGroups = computed<ToolGroup[]>(() => {
  if (!entry.value) {
    return []
  }

  const tools = getGoogleServiceTools(entry.value.service).filter((tool) => {
    return tool.client === 'besidka' || isOwnClientOwner.value
  })

  return [
    {
      kind: 'read' as const,
      label: 'Read',
      tools: tools.filter(tool => tool.kind === 'read'),
    },
    {
      kind: 'write' as const,
      label: 'Write',
      tools: tools.filter(tool => tool.kind === 'write'),
    },
  ].filter(group => group.tools.length > 0)
})

const isDriveWriteGranted = computed<boolean>(() => {
  const connection = data.value?.byo?.connection

  return connection?.status === 'active'
    && connection.capabilities.includes('drive-write')
})

function getUnavailableHint(tool: GoogleToolCatalogEntry): string {
  const hint = getGoogleToolAlwaysAllowHint(tool)

  return tool.neededCapability === 'drive-write' && !isDriveWriteGranted.value
    ? `${hint} Needs Change files access.`
    : hint
}

const hasPermissionData = computed<boolean>(() => {
  return permissions.tools.value.length > 0
})

const permissionGroups = computed<ToolPermissionGroup[]>(() => {
  const modesByName = new Map(permissions.tools.value.map((tool) => {
    return [tool.name, tool.mode]
  }))

  return toolGroups.value.map((group) => {
    return {
      id: group.kind,
      label: group.label,
      tools: group.tools
        .filter(tool => modesByName.has(tool.name))
        .map((tool) => {
          return {
            name: tool.name,
            title: tool.title,
            mode: modesByName.get(tool.name) ?? 'ask',
            modes: GOOGLE_TOOL_PERMISSION_MODES,
            unavailableHint: getUnavailableHint(tool),
          }
        }),
    }
  })
})

const isToolsSectionShown = computed<boolean>(() => {
  if (!toolGroups.value.length || permissions.isUnavailable.value) {
    return false
  }

  if (!hasPermissionData.value) {
    return permissions.status.value === 'pending'
      || permissions.error.value !== null
  }

  return permissionGroups.value.some(group => group.tools.length > 0)
})

async function saveChanges(changes: ToolPermissionChange[]) {
  for (const change of changes) {
    if (isGoogleToolPermissionMode(change.mode)) {
      await permissions.save({ tool: change.name }, change.mode)
    }
  }
}

async function onSetTools(changes: ToolPermissionChange[]) {
  await saveChanges(changes)
}

async function onSetGroup(
  groupId: string,
  mode: ToolPermissionMode,
) {
  const kind = GOOGLE_TOOL_KINDS.find(candidate => candidate === groupId)

  if (!entry.value || !kind || !isGoogleToolPermissionMode(mode)) {
    return
  }

  await permissions.save({ service: entry.value.service, kind }, mode)
}

const toolsIntro = computed<string>(() => {
  const listedTools = toolGroups.value.flatMap(group => group.tools)
  const asksEveryTime = listedTools.filter((tool) => {
    return getGoogleToolApprovalLabel(tool)
      === GOOGLE_TOOL_APPROVAL_LABELS.asksEveryTime
  })
  const readSubjects = [
    asksEveryTime.some(tool => tool.kind === 'read' && tool.service === 'gmail')
      ? 'mail'
      : null,
    asksEveryTime.some(tool => tool.kind === 'read' && tool.service === 'drive')
      ? 'found files'
      : null,
  ].filter(subject => subject !== null)
  const subjects = [
    asksEveryTime.some(tool => tool.kind === 'write') ? 'Writes' : null,
    readSubjects.length ? `reads of ${readSubjects.join(' or ')}` : null,
  ].filter(subject => subject !== null)
  const intro = 'Besidka asks before a Google tool runs.'

  if (!subjects.length) {
    return intro
  }

  const sentence = `${subjects.join(' and ')} ask every time.`

  return `${intro} ${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`
})

const ownClientNote = computed<OwnClientNote | null>(() => {
  const byo = data.value?.byo

  if (entry.value?.id !== 'google-drive' || !byo?.canManage) {
    return null
  }

  if (!byo.hasClient) {
    return {
      text: 'Searching your whole Google Drive needs your own Google client.',
      linkPath: GOOGLE_KEYS_TAB_PATH,
    }
  }

  const hasDriveRead = byo.connection?.status === 'active'
    && byo.connection.capabilities.includes('drive-read')

  return hasDriveRead
    ? null
    : {
      text: 'Searching your whole Google Drive needs Google Drive read '
        + 'access.',
      linkPath: null,
    }
})

async function disconnect() {
  if (entry.value) {
    await actions.disconnect(entry.value)
  }
}
</script>
