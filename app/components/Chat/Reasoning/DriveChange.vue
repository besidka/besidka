<template>
  <div
    class="min-w-0 rounded-box bg-base-200 p-2 text-xs"
    data-testid="reasoning-approval-step-drive-change"
  >
    <dl
      v-if="view.kind === 'create-folder'"
      class="grid gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]"
    >
      <dt class="text-base-content/60">
        New folder
      </dt>
      <dd
        class="min-w-0 break-words font-medium"
        data-testid="reasoning-approval-step-drive-change-name"
      >
        {{ view.name }}
      </dd>
      <dt class="text-base-content/60">
        Inside
      </dt>
      <dd
        class="min-w-0 break-words"
        data-testid="reasoning-approval-step-drive-change-parent"
      >
        <template v-if="view.parent.isRoot">
          {{ GOOGLE_DRIVE_ROOT_CARD_LABEL }}
        </template>
        <template v-else>
          {{ quotedName(view.parent.name, 'A folder from this chat') }}
          <span
            class="block break-all text-base-content/60"
            data-testid="reasoning-approval-step-drive-change-parent-id"
          >{{ view.parent.id }}</span>
        </template>
      </dd>
    </dl>
    <dl
      v-else-if="view.kind === 'rename'"
      class="grid gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]"
    >
      <dt class="text-base-content/60">
        Old name
      </dt>
      <dd
        class="min-w-0 break-words"
        data-testid="reasoning-approval-step-drive-change-old-name"
      >
        {{ quotedName(view.item.name, itemFallback) }}
        <span class="block text-base-content/60">as found in this chat</span>
        <span
          class="block break-all text-base-content/60"
          data-testid="reasoning-approval-step-drive-change-item-id"
        >{{ view.item.id }}</span>
      </dd>
      <dt class="text-base-content/60">
        New name
      </dt>
      <dd
        class="min-w-0 break-words font-medium"
        data-testid="reasoning-approval-step-drive-change-name"
      >
        {{ view.newName }}
      </dd>
      <dt class="text-base-content/60">
        Type
      </dt>
      <dd data-testid="reasoning-approval-step-drive-change-type">
        {{ itemTypeLabel }}
      </dd>
    </dl>
    <template v-else>
      <dl class="grid gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]">
        <dt class="text-base-content/60">
          Name
        </dt>
        <dd
          class="min-w-0 break-words font-medium"
          data-testid="reasoning-approval-step-drive-change-name"
        >
          {{ quotedName(view.item.name, itemFallback) }}
          <span
            class="block break-all font-normal text-base-content/60"
            data-testid="reasoning-approval-step-drive-change-item-id"
          >{{ view.item.id }}</span>
        </dd>
        <dt class="text-base-content/60">
          From
        </dt>
        <dd
          class="min-w-0 break-words"
          data-testid="reasoning-approval-step-drive-change-from"
        >
          <template v-if="view.from.isRoot">
            {{ GOOGLE_DRIVE_ROOT_CARD_LABEL }}
          </template>
          <template v-else>
            {{ quotedName(view.from.name, 'A folder from this chat') }}
            <span
              class="block break-all text-base-content/60"
              data-testid="reasoning-approval-step-drive-change-from-id"
            >{{ view.from.id }}</span>
          </template>
        </dd>
        <dt class="text-base-content/60">
          To
        </dt>
        <dd
          class="min-w-0 break-words font-medium"
          data-testid="reasoning-approval-step-drive-change-to"
        >
          <template v-if="view.to.isRoot">
            {{ GOOGLE_DRIVE_ROOT_CARD_LABEL }}
          </template>
          <template v-else>
            {{ quotedName(view.to.name, 'A folder from this chat') }}
            <span
              class="block break-all font-normal text-base-content/60"
              data-testid="reasoning-approval-step-drive-change-to-id"
            >{{ view.to.id }}</span>
          </template>
        </dd>
      </dl>
      <p
        v-if="view.item.kind === 'folder'"
        class="mt-1 text-base-content/60"
        data-testid="reasoning-approval-step-drive-change-folder-note"
      >
        Everything inside moves with it.
      </p>
    </template>
    <p
      class="mt-2 text-base-content/60"
      data-testid="reasoning-approval-step-drive-change-note"
    >
      {{ GOOGLE_DRIVE_WRITE_FOOTER }}
    </p>
  </div>
</template>

<script setup lang="ts">
import {
  GOOGLE_DRIVE_ROOT_CARD_LABEL,
  GOOGLE_DRIVE_WRITE_FOOTER,
} from '#shared/utils/google-drive-write'
import type { DriveWriteApprovalView } from '#shared/utils/google-drive-write'

const props = defineProps<{
  view: DriveWriteApprovalView
}>()

const itemFallback = 'A file or folder from this chat'

const itemTypeLabel = computed<string>(() => {
  if (props.view.kind === 'create-folder') {
    return ''
  }

  const { kind } = props.view.item

  if (kind === 'folder') {
    return 'Folder'
  }

  return kind === 'file' ? 'File' : 'File or folder'
})

function quotedName(name: string | null, fallback: string): string {
  return name ? `“${name}”` : fallback
}
</script>
