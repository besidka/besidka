<template>
  <section
    v-if="grants.length"
    class="grid gap-1"
    :aria-labelledby="headingId"
    data-testid="chat-context-approvals"
  >
    <h4
      :id="headingId"
      class="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-base-content/60"
    >
      Approvals
      <span class="font-normal normal-case tracking-normal">
        {{ grants.length }}
      </span>
    </h4>
    <ul
      class="grid gap-0.5"
      data-testid="chat-context-approvals-list"
    >
      <li
        v-for="grant in grants"
        :key="grantKeyOf(grant)"
        class="flex items-center gap-2 rounded-field px-2 py-1"
        :data-testid="`chat-context-approval-${grant.scope}`"
      >
        <span class="grid size-7 shrink-0 place-items-center rounded-field bg-base-200 text-base-content/70">
          <Icon
            :name="grant.scope === 'always'
              ? 'lucide:shield-check'
              : 'lucide:message-square-check'"
            size="16"
            class="size-4"
          />
        </span>
        <span class="min-w-0 grow">
          <span class="block truncate text-sm leading-tight">
            {{ grant.toolName }}
          </span>
          <span class="block truncate text-xs leading-tight text-base-content/60">
            {{ grant.connectorTitle }} · {{ scopeLabel(grant) }}
          </span>
        </span>
        <NuxtLink
          v-if="grant.scope === 'always' && grant.source === 'besidka'"
          :to="besidkaPermissionsPath"
          class="btn btn-ghost btn-xs min-h-6 shrink-0"
          :aria-label="`Change the permission of ${grant.toolName}`"
          data-testid="chat-context-approval-manage-besidka"
        >
          Manage
        </NuxtLink>
        <button
          v-else-if="grant.scope === 'always'"
          type="button"
          class="btn btn-ghost btn-xs min-h-6 shrink-0"
          :disabled="!!busyKey"
          :aria-label="`Remove Always allow for ${grant.toolName}`"
          data-testid="chat-context-approval-remove"
          @click="revokeAlwaysGrant(grant)"
        >
          Remove
        </button>
      </li>
    </ul>
    <div
      v-if="hasChatGrants"
      class="mt-1 px-2"
    >
      <button
        type="button"
        class="btn btn-soft btn-sm max-md:w-full"
        :disabled="!!busyKey"
        data-testid="chat-context-approvals-reset"
        @click="resetChatGrants"
      >
        <Icon
          name="lucide:rotate-ccw"
          size="16"
        />
        Reset approvals in this chat
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { getBesidkaToolPermissionsPath } from '~/utils/besidka-tool-permissions'
import type {
  ToolApprovalGrantItem,
} from '#shared/types/tool-approval-grants.d'

const headingId = useId()
const connectorsFeature = useFeature('connectors')

const besidkaPermissionsPath = computed<string>(() => {
  return getBesidkaToolPermissionsPath(connectorsFeature.value.active)
})
const {
  grants,
  hasChatGrants,
  busyKey,
  refresh,
  resetChatGrants,
  revokeAlwaysGrant,
} = useChatToolApprovalGrants()

const nuxtApp = useNuxtApp()
const removeHooks = [
  nuxtApp.hook('chat:generation-finished', () => {
    refresh()
  }),
]

onMounted(() => {
  refresh()
})

onBeforeUnmount(() => {
  removeHooks.forEach((removeHook) => {
    removeHook()
  })
})

function scopeLabel(grant: ToolApprovalGrantItem): string {
  return grant.scope === 'always'
    ? 'Always allowed, in every chat'
    : 'Allowed in this chat'
}
</script>
